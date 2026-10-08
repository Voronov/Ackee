import test from 'ava'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import aggregateTopRecords from '../../src/aggregations/aggregateTopRecords.js'
import aggregateViews from '../../src/aggregations/aggregateViews.js'
import { INTERVALS_DAILY } from '../../src/constants/intervals.js'
import { RANGES_LAST_30_DAYS } from '../../src/constants/ranges.js'
import Record from '../../src/models/Record.js'
import Rollup from '../../src/models/Rollup.js'
import RollupState from '../../src/models/RollupState.js'
import { buildRange } from '../../src/rollups/build.js'
import { floorHour } from '../../src/rollups/dimension.js'
import { topRecords, views } from '../../src/rollups/read.js'
import registry from '../../src/rollups/registry.js'
import createDate from '../../src/utils/createDate.js'

// Config reads the environment on every access, not at import time, so setting the flag
// before the first read is enough.
process.env.ACKEE_ROLLUPS = 'true'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const mongoDb = MongoMemoryServer.create()
const domainId = uuid()

const pages = ['https://example.com/', 'https://example.com/a', 'https://example.com/b']
const referrers = ['https://google.com/', 'https://news.example/', null]
const sources = ['newsletter', null, null]
const browsers = ['Safari', 'Chrome']

test.before(async () => {
  const { default: connect } = await import('../../src/utils/connect.js')
  await connect((await mongoDb).getUri())

  const now = Date.now()

  // Records are spread across hours and days on purpose: it is at hour boundaries that
  // the hybrid read, rollups plus raw edges, could disagree with a direct aggregation.
  const records = Array.from({ length: 240 }, (_, index) => {
    const created = new Date(now - index * 47 * 60 * 1000)

    return {
      clientId: `client-${index % 17}`,
      domainId,
      siteLocation: pages[index % pages.length],
      siteReferrer: referrers[index % referrers.length],
      source: sources[index % sources.length],
      siteLanguage: index % 5 === 0 ? 'uk' : 'en',
      screenWidth: 1920,
      screenHeight: 1080,
      screenColorDepth: 24,
      deviceName: 'MacBook Pro',
      deviceManufacturer: 'Apple',
      osName: 'macOS',
      osVersion: '15.0',
      browserName: browsers[index % browsers.length],
      browserVersion: '140.0',
      browserWidth: 1440,
      browserHeight: 900,
      created,
      updated: created,
    }
  })

  await Record.insertMany(records)

  // Build further back than needed so the 30-day window fits inside the covered range;
  // otherwise the read path would decline and fall back to raw records.
  const to = floorHour(new Date())
  const from = new Date(to.getTime() - 31 * DAY)

  await buildRange(domainId, from, to)
  await RollupState.create({ domainId, from, to })
})

test.after.always(async () => {
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

const normalize = (entries) =>
  entries
    .map((entry) => ({ key: JSON.stringify(entry._id), count: entry.count }))
    .toSorted((left, right) => right.count - left.count || left.key.localeCompare(right.key))

test('rollups are built', async (t) => {
  t.true((await Rollup.countDocuments({ domainId })) > 0)
})

test('reading rollups matches a direct aggregation', async (t) => {
  const dateDetails = createDate('Europe/Kyiv')
  const ids = [domainId]

  // The views dimension has no fields and uses its own read path, so it is excluded here.
  for (const { properties, or = false } of registry.filter((entry) => entry.properties.length > 0)) {
    const raw = await Record.aggregate(aggregateTopRecords(ids, properties, RANGES_LAST_30_DAYS, 30, dateDetails, or))
    const rolled = await topRecords(ids, properties, RANGES_LAST_30_DAYS, 30, dateDetails, or)

    t.not(rolled, null, `dimension ${properties.join('|')} should have come from rollups`)
    t.deepEqual(normalize(rolled), normalize(raw), `dimension ${properties.join('|')} disagrees`)
  }
})

test('an uncovered range falls back to raw records', async (t) => {
  const other = uuid()

  await Record.create({
    domainId: other,
    siteLocation: 'https://example.com/',
    created: new Date(),
    updated: new Date(),
  })

  const rolled = await topRecords([other], ['siteLocation'], RANGES_LAST_30_DAYS, 30, createDate('UTC'))

  t.is(rolled, null)
})

// Regression for D-001: before the secondary sort key, three identical requests over
// unchanged data could return three different answers.
test('top results are deterministic in order and membership', async (t) => {
  const dateDetails = createDate('Europe/Kyiv')
  const ids = [domainId]
  const properties = ['siteLocation']

  const raw = await Promise.all(
    Array.from({ length: 3 }, () =>
      Record.aggregate(aggregateTopRecords(ids, properties, RANGES_LAST_30_DAYS, 2, dateDetails)),
    ),
  )

  t.deepEqual(raw[0], raw[1])
  t.deepEqual(raw[1], raw[2])

  // Limited to two on purpose: at the `$limit` cut-off an unstable sort used to change
  // not just the order but which rows appeared at all.
  const rolled = await topRecords(ids, properties, RANGES_LAST_30_DAYS, 2, dateDetails)

  t.deepEqual(
    rolled.map((entry) => entry._id.siteLocation),
    raw[0].map((entry) => entry._id.siteLocation),
  )
})

test('views from rollups match a direct aggregation', async (t) => {
  const ids = [domainId]

  // Deliberately not UTC: this is where a daily bucket would give wrong numbers and an
  // hourly one has to regroup cleanly.
  for (const timeZone of ['Europe/Kyiv', 'UTC', 'America/New_York']) {
    const dateDetails = createDate(timeZone)

    const raw = await Record.aggregate(aggregateViews(ids, false, INTERVALS_DAILY, 30, dateDetails))
    const rolled = await views(ids, INTERVALS_DAILY, 30, dateDetails)

    t.not(rolled, null, `${timeZone}: views should have come from rollups`)
    t.deepEqual(normalize(rolled), normalize(raw), `${timeZone}: views disagree`)
  }
})
