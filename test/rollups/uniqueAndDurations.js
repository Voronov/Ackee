import test from 'ava'
import { startOfDay } from 'date-fns'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import aggregateDurations from '../../src/aggregations/aggregateDurations.js'
import aggregateViews from '../../src/aggregations/aggregateViews.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY } from '../../src/constants/intervals.js'
import Record from '../../src/models/Record.js'
import RollupState from '../../src/models/RollupState.js'
import { durations, uniqueViews } from '../../src/rollups/read.js'
import { backfill, refresh } from '../../src/rollups/worker.js'
import createDate from '../../src/utils/createDate.js'

// Config reads the environment on every access, so setting the flags here is enough.
process.env.ACKEE_ROLLUPS = 'true'
process.env.ACKEE_ROLLUPS_UNIQUE = 'true'
process.env.ACKEE_ROLLUPS_DURATIONS = 'true'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const mongoDb = MongoMemoryServer.create()

const timeZones = ['Europe/Kyiv', 'UTC', 'America/New_York']

// Visits spread over three days and across hour boundaries, with durations below the
// tracking interval, in between and above the limit, so every branch of the durations
// pipeline lands in some bucket. One old record stretches the history past the 30-day
// window; rollups that do not cover the whole window are not read.
const seed = async (domainId) => {
  const now = Date.now()
  const elapsed = [0, 5000, 20_000, 10 * MINUTE, 29 * MINUTE, 31 * MINUTE, 3 * HOUR]
  const old = new Date(now - 40 * DAY)

  await Record.create({ domainId, siteLocation: 'https://example.com/', created: old, updated: old })

  await Record.insertMany(
    Array.from({ length: 300 }, (_, index) => {
      const created = new Date(now - index * 17 * MINUTE)

      return {
        // Every third record is anonymized, as earlier records of a visitor are.
        clientId: index % 3 === 0 ? null : `client-${index % 23}`,
        domainId,
        siteLocation: 'https://example.com/',
        created,
        updated: new Date(created.getTime() + elapsed[index % elapsed.length]),
      }
    }),
  )
}

const normalize = (entries) =>
  entries
    .map((entry) => ({ key: JSON.stringify(entry._id), count: entry.count }))
    .toSorted((left, right) => left.key.localeCompare(right.key))

// Months reach back as far as the history does only for the current one.
const limits = { [INTERVALS_DAILY]: 30, [INTERVALS_MONTHLY]: 1 }

const rawUnique = (ids, interval, dateDetails) =>
  Record.aggregate(aggregateViews(ids, true, interval, limits[interval], dateDetails))

const rawDurations = (ids, interval, dateDetails) =>
  Record.aggregate(aggregateDurations(ids, interval, limits[interval], dateDetails))

test.before(async () => {
  const { default: connect } = await import('../../src/utils/connect.js')
  await connect((await mongoDb).getUri())
})

test.after.always(async () => {
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

test('backfill seals every day before today', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)

  const state = await RollupState.findOne({ domainId }).lean()

  t.is(state.sealed.getTime(), startOfDay(new Date()).getTime())
})

test('unique views from rollups match a direct aggregation', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)

  for (const timeZone of timeZones) {
    for (const interval of [INTERVALS_DAILY, INTERVALS_MONTHLY]) {
      const dateDetails = createDate(timeZone)
      const rolled = await uniqueViews([domainId], interval, limits[interval], dateDetails)

      t.not(rolled, null, `${timeZone} ${interval}: should have come from rollups`)
      t.deepEqual(normalize(rolled), normalize(await rawUnique([domainId], interval, dateDetails)), timeZone)
    }
  }
})

// The case the seal exists for: a later visit anonymizes records of the running day after
// their bucket was built. Today is read from raw records, so the numbers still agree.
test('unique views stay exact when today is anonymized after the build', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)

  const today = startOfDay(new Date())
  await Record.updateMany({ domainId, created: { $gte: today } }, { $set: { clientId: null } })

  const dateDetails = createDate('Europe/Kyiv')
  const rolled = await uniqueViews([domainId], INTERVALS_DAILY, 30, dateDetails)

  t.deepEqual(normalize(rolled), normalize(await rawUnique([domainId], INTERVALS_DAILY, dateDetails)))
})

test('refresh rebuilds the day that ended since the last seal', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)

  // As if the last pass had run yesterday: yesterday was still open, and its records were
  // anonymized after the buckets were built.
  const today = startOfDay(new Date())
  const yesterday = new Date(today.getTime() - DAY)
  await RollupState.updateOne({ domainId }, { $set: { sealed: yesterday } })
  await Record.updateMany({ domainId, created: { $gte: yesterday, $lt: today } }, { $set: { clientId: null } })

  await refresh(domainId)

  const state = await RollupState.findOne({ domainId }).lean()
  const dateDetails = createDate('UTC')
  const rolled = await uniqueViews([domainId], INTERVALS_DAILY, 30, dateDetails)

  t.is(state.sealed.getTime(), today.getTime())
  t.deepEqual(normalize(rolled), normalize(await rawUnique([domainId], INTERVALS_DAILY, dateDetails)))
})

test('unique views without a seal fall back to raw records', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)
  await RollupState.updateOne({ domainId }, { $unset: { sealed: 1 } })

  t.is(await uniqueViews([domainId], INTERVALS_DAILY, 30, createDate('UTC')), null)
})

// Averages are compared as they are: an exact integer sum divided once is the same float
// that $avg yields on raw records.
test('durations from rollups match a direct aggregation', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)

  for (const timeZone of timeZones) {
    for (const interval of [INTERVALS_DAILY, INTERVALS_MONTHLY]) {
      const dateDetails = createDate(timeZone)
      const rolled = await durations([domainId], interval, limits[interval], dateDetails)

      t.not(rolled, null, `${timeZone} ${interval}: should have come from rollups`)
      t.deepEqual(normalize(rolled), normalize(await rawDurations([domainId], interval, dateDetails)), timeZone)
    }
  }
})

// Serial: it flips flags the concurrent tests rely on.
test.serial('the spike read paths stay off without their flags', async (t) => {
  const domainId = uuid()
  await seed(domainId)
  await backfill(domainId)

  process.env.ACKEE_ROLLUPS_UNIQUE = 'false'
  process.env.ACKEE_ROLLUPS_DURATIONS = 'false'
  t.teardown(() => {
    process.env.ACKEE_ROLLUPS_UNIQUE = 'true'
    process.env.ACKEE_ROLLUPS_DURATIONS = 'true'
  })

  t.is(await uniqueViews([domainId], INTERVALS_DAILY, 30, createDate('UTC')), null)
  t.is(await durations([domainId], INTERVALS_DAILY, 30, createDate('UTC')), null)
})
