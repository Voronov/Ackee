import test from 'ava'
import mockedEnv from 'mocked-env'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { run as migrate } from '../../scripts/migrate-to-clickhouse.js'
import { run as seed } from '../../scripts/seed-records.js'
import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import { BROWSERS_TYPE_NO_VERSION, BROWSERS_TYPE_WITH_VERSION } from '../../src/constants/browsers.js'
import { DEVICES_TYPE_NO_MODEL, DEVICES_TYPE_WITH_MODEL } from '../../src/constants/devices.js'
import { DURATIONS_INTERVAL, DURATIONS_LIMIT } from '../../src/constants/durations.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../../src/constants/intervals.js'
import * as rangeConstants from '../../src/constants/ranges.js'
import {
  REFERRERS_TYPE_NO_SOURCE,
  REFERRERS_TYPE_ONLY_SOURCE,
  REFERRERS_TYPE_WITH_SOURCE,
} from '../../src/constants/referrers.js'
import * as sizeConstants from '../../src/constants/sizes.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../../src/constants/sortings.js'
import { SYSTEMS_TYPE_NO_VERSION, SYSTEMS_TYPE_WITH_VERSION } from '../../src/constants/systems.js'
import { VIEWS_TYPE_TOTAL, VIEWS_TYPE_UNIQUE } from '../../src/constants/views.js'
import { anonymize } from '../../src/database/records.js'
import Action from '../../src/models/Action.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import * as clickhouse from '../../src/stores/clickhouse/index.js'
import { flush } from '../../src/stores/clickhouse/writer.js'
import * as dual from '../../src/stores/dual/index.js'
import * as mongo from '../../src/stores/mongo/index.js'
import connect from '../../src/utils/connect.js'
import createDate from '../../src/utils/createDate.js'
import { day, hour, minute } from '../../src/utils/times.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const restore = mockedEnv({ ACKEE_CLICKHOUSE_DATABASE: database })

const mongoDb = MongoMemoryServer.create()

// The seed's "now" is fixed so that both stores are asked about the same window
const now = new Date('2026-09-21T12:00:00.000Z')
const records = 50000
const days = 60
const eventId = 'event'

// MongoDB accepts fixed offsets next to IANA names, so they must group the same way too
const timeZones = ['UTC', 'Europe/Kiev', 'America/Los_Angeles', 'Asia/Kolkata', '+05:30', '-03:00', '+0530', '+05']
const ranges = Object.values(rangeConstants)
const sortings = [SORTINGS_TOP, SORTINGS_NEW, SORTINGS_RECENT]
const intervals = {
  [INTERVALS_DAILY]: [1, 7, 15, 30, 61],
  [INTERVALS_MONTHLY]: [1, 3, 6],
  [INTERVALS_YEARLY]: [1, 2],
}
const limits = [30, 3]
const everythingLimit = 100000

const context = {}

const dateDetails = (timeZone = 'UTC') => createDate(timeZone, now)

// Visits that projectMinInterval and matchLimit must treat specially: below the tracking
// interval, exactly at it, and beyond the duration limit
const outliers = (domainId) =>
  [0, 1, DURATIONS_INTERVAL - 1, DURATIONS_INTERVAL, DURATIONS_LIMIT - 1, DURATIONS_LIMIT, 2 * hour].flatMap(
    (duration, index) =>
      Array.from({ length: 3 }, (_, offset) => {
        const created = new Date(now.getTime() - index * day - offset * hour - minute)
        return {
          id: uuid(),
          clientId: `outlier-${index}-${offset}`,
          domainId,
          siteLocation: 'https://example.com/outlier/',
          created,
          updated: new Date(created.getTime() + duration),
        }
      }),
  )

// Some keys repeat, some values are missing, some actions have no key at all
const actions = () =>
  Array.from({ length: 24 }, (_, index) => {
    const created = new Date(now.getTime() - index * 2 * day - index * hour)
    return {
      id: uuid(),
      eventId,
      key: index % 5 === 4 ? undefined : `Key ${index % 6}`,
      value: index % 7 === 6 ? undefined : (index % 4) * 10 + 1,
      details: index % 2 === 0 ? 'Details' : undefined,
      created,
      updated: new Date(created.getTime() + 1000),
    }
  })

// Records created live through the dual store, so activeVisitors has something to count
const liveRecords = (domainId) =>
  Array.from({ length: 5 }, (_, index) => ({
    clientId: index === 4 ? undefined : `live-${index}`,
    domainId,
    siteLocation: 'https://example.com/live/',
    siteLanguage: 'en',
  }))

const run = (store, name, parameters) => store[name](...parameters)

const iso = (entry) => (entry.created instanceof Date ? { ...entry, created: entry.created.toISOString() } : entry)

// Rows with the same count or the same created have no defined order in either store
const compare = (a, b) => {
  if (a.count !== b.count) return b.count - a.count
  if (a.created !== b.created) return a.created < b.created ? 1 : -1
  if (a.value === b.value) return 0
  return a.value < b.value ? -1 : 1
}

const normalize = (entries) => entries.map(iso).toSorted(compare)

const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Both stores sort by one key and cut at the limit, so the rows tied on that key at the
// boundary are an arbitrary pick in either store. Everything above the boundary must
// match exactly; the tied rows must be tied rows MongoDB knows about.
const assertSameRanking = (t, actual, expected, everything, rank, label) => {
  t.is(actual.length, expected.length, label)
  t.deepEqual(actual.map(rank), expected.map(rank), label)

  if (expected.length === 0) return

  const boundary = rank(expected.at(-1))

  t.deepEqual(
    actual.filter((row) => rank(row) !== boundary),
    expected.filter((row) => rank(row) !== boundary),
    label,
  )

  const tied = everything.filter((row) => rank(row) === boundary)

  for (const row of actual.filter((row) => rank(row) === boundary)) {
    t.true(
      tied.some((candidate) => sameRow(candidate, row)),
      `${label}: ${row.value} is not one of the rows tied at ${boundary}`,
    )
  }
}

const rankOf = (sorting) => (sorting === SORTINGS_TOP ? (row) => row.count : (row) => row.created)

const assertSameGrouped = async (t, report, ids, sorting, argumentsWithoutLimit, label) => {
  const withLimit = (limit) => [ids, ...argumentsWithoutLimit(limit), dateDetails()]
  const everything = normalize(await run(mongo, report, withLimit(everythingLimit)))

  for (const limit of limits) {
    const actual = normalize(await run(clickhouse, report, withLimit(limit)))
    const expected = normalize(await run(mongo, report, withLimit(limit)))

    if (expected.length < limit) t.deepEqual(actual, expected, `${label}, limit ${limit}`)
    else assertSameRanking(t, actual, expected, everything, rankOf(sorting), `${label}, limit ${limit}`)
  }
}

const assertSameIntervals = async (t, report, ids, argumentsFor, label) => {
  for (const [interval, intervalLimits] of Object.entries(intervals)) {
    for (const limit of intervalLimits) {
      for (const timeZone of timeZones) {
        const parameters = [ids, ...argumentsFor(interval, limit), dateDetails(timeZone)]
        const actual = await run(clickhouse, report, parameters)
        const expected = await run(mongo, report, parameters)

        t.is(actual.length, limit)
        t.deepEqual(actual, expected, `${label}, ${interval}, limit ${limit}, ${timeZone}`)
      }
    }
  }
}

const query = async (sql, parameters) => {
  const result = await getClient().query({
    query: sql,
    query_params: { database, ...parameters },
    format: 'JSONEachRow',
  })
  return result.json()
}

const count = async (table, final) => {
  const [row] = await query(
    `SELECT count() AS count FROM {database:Identifier}.{table:Identifier} ${final === true ? 'FINAL' : ''}`,
    { table },
  )
  return Number(row.count)
}

test.before(async () => {
  await connect((await mongoDb).getUri())
  await ensureSchema(database)

  const domain = await Domain.create({ title: 'Parity', workspaceId: uuid() })
  const second = await Domain.create({ title: 'Parity second', workspaceId: uuid() })
  context.ids = [domain.id]
  context.bothIds = [domain.id, second.id]

  await seed({ records, days, seed: 42, batch: 5000, now: now.getTime(), dryRun: false, domainId: domain.id })
  await seed({ records: 5000, days, seed: 7, batch: 5000, now: now.getTime(), dryRun: false, domainId: second.id })
  await Record.insertMany(outliers(domain.id), { ordered: false, lean: true })
  await Action.insertMany(actions(), { ordered: false, lean: true })

  const visitors = await Record.distinct('clientId', { domainId: domain.id })

  for (const clientId of visitors.slice(0, 3)) {
    await anonymize(clientId, 'none')
  }

  await migrate({ batch: 10000, reset: false, dryRun: false })

  // Changes after the migration arrive as row versions through the dual store
  for (const clientId of visitors.slice(3, 6)) {
    const latest = await Record.findOne({ clientId }).sort({ created: -1 }).lean()
    await dual.anonymize(clientId, latest.id)
  }

  for (const record of await Record.find({ domainId: domain.id }).sort({ created: -1 }).limit(5).lean()) {
    await dual.touchRecord(record.id)
  }

  for (const action of await Action.find({}).sort({ created: -1 }).limit(2).lean()) {
    await dual.touchAction(action.id, { key: action.key, value: 99, details: 'Touched' })
  }

  await flush()
})

test.after.always(async () => {
  await getClient().command({ query: 'DROP DATABASE IF EXISTS {database:Identifier}', query_params: { database } })
  await close()
  await mongoose.disconnect()
  await (await mongoDb).stop()
  restore()
})

test.serial('holds more row versions than records and collapses them with FINAL', async (t) => {
  const inMongo = await Record.countDocuments({})

  t.is(await count('records', true), inMongo)
  t.true((await count('records', false)) > inMongo)
  t.is(await count('actions', true), await Action.countDocuments({}))
  t.true((await count('actions', false)) > (await Action.countDocuments({})))
})

for (const type of [VIEWS_TYPE_UNIQUE, VIEWS_TYPE_TOTAL]) {
  test.serial(`views ${type} match for every interval, limit and time zone`, async (t) => {
    await assertSameIntervals(t, 'views', context.ids, (interval, limit) => [type, interval, limit], type)
  })
}

test.serial('views are zero for an unknown domain and for no domain', async (t) => {
  for (const ids of [['unknown'], []]) {
    const parameters = [ids, VIEWS_TYPE_TOTAL, INTERVALS_DAILY, 7, dateDetails()]
    const actual = await clickhouse.views(...parameters)

    t.deepEqual(actual, await mongo.views(...parameters))
    t.deepEqual(
      actual.map((entry) => entry.count),
      Array.from({ length: 7 }).fill(0),
    )
  }
})

test.serial('durations match for every interval, limit and time zone, outliers included', async (t) => {
  await assertSameIntervals(t, 'durations', context.ids, (interval, limit) => [interval, limit], 'durations')

  // A sanity check that the aggregation measures anything at all, rather than matching
  // two empty results. Not pinned to today: the fixture puts the zero-duration visits on
  // `now` and the longer ones a day apart, so which days carry a duration depends on the
  // hour the suite runs at.
  const week = await mongo.durations(context.ids, INTERVALS_DAILY, 7, dateDetails())
  const measured = week.filter((entry) => entry.count > 0)

  t.true(measured.length > 0)
  t.true(measured.every((entry) => entry.count < DURATIONS_LIMIT))
})

const grouped = [
  { report: 'pages', types: [undefined] },
  { report: 'referrers', types: [REFERRERS_TYPE_WITH_SOURCE, REFERRERS_TYPE_NO_SOURCE, REFERRERS_TYPE_ONLY_SOURCE] },
  { report: 'systems', types: [SYSTEMS_TYPE_NO_VERSION, SYSTEMS_TYPE_WITH_VERSION] },
  { report: 'devices', types: [DEVICES_TYPE_NO_MODEL, DEVICES_TYPE_WITH_MODEL] },
  { report: 'browsers', types: [BROWSERS_TYPE_NO_VERSION, BROWSERS_TYPE_WITH_VERSION] },
  { report: 'sizes', types: Object.values(sizeConstants) },
  { report: 'languages', types: [undefined] },
]

const groupedArguments = (sorting, type, range) => (limit) =>
  type === undefined ? [sorting, range, limit] : [sorting, type, range, limit]

for (const { report, types } of grouped) {
  test.serial(`${report} TOP matches for every type, range and limit`, async (t) => {
    for (const type of types) {
      for (const range of ranges) {
        await assertSameGrouped(
          t,
          report,
          context.ids,
          SORTINGS_TOP,
          groupedArguments(SORTINGS_TOP, type, range),
          `${report} TOP ${type ?? ''} ${range}`,
        )
      }
    }
  })

  test.serial(`${report} RECENT matches for every type and limit`, async (t) => {
    for (const type of types) {
      await assertSameGrouped(
        t,
        report,
        context.ids,
        SORTINGS_RECENT,
        groupedArguments(SORTINGS_RECENT, type, rangeConstants.RANGES_LAST_7_DAYS),
        `${report} RECENT ${type ?? ''}`,
      )
    }
  })

  test.serial(`${report} NEW matches for every type and limit`, async (t) => {
    for (const type of types) {
      await assertSameGrouped(
        t,
        report,
        context.ids,
        SORTINGS_NEW,
        groupedArguments(SORTINGS_NEW, type, rangeConstants.RANGES_LAST_7_DAYS),
        `${report} NEW ${type ?? ''}`,
      )
    }
  })

  test.serial(`${report} is empty for an unknown domain`, async (t) => {
    for (const sorting of sortings) {
      const parameters = [['unknown'], ...groupedArguments(sorting, types[0], ranges[0])(30), dateDetails()]

      t.deepEqual(await run(clickhouse, report, parameters), [])
      t.deepEqual(await run(mongo, report, parameters), [])
    }
  })
}

test.serial('reports over two domains match for TOP and NEW and see both domains', async (t) => {
  const range = rangeConstants.RANGES_LAST_30_DAYS
  const sum = (entries) => entries.reduce((total, entry) => total + entry.count, 0)
  const total = (ids) => mongo.views(ids, VIEWS_TYPE_TOTAL, INTERVALS_DAILY, 30, dateDetails())

  t.true(sum(await total(context.bothIds)) > sum(await total(context.ids)))

  for (const sorting of [SORTINGS_TOP, SORTINGS_NEW]) {
    await assertSameGrouped(
      t,
      'pages',
      context.bothIds,
      sorting,
      groupedArguments(sorting, undefined, range),
      `pages ${sorting}, two domains`,
    )
    await assertSameGrouped(
      t,
      'browsers',
      context.bothIds,
      sorting,
      groupedArguments(sorting, BROWSERS_TYPE_WITH_VERSION, range),
      `browsers ${sorting} WITH_VERSION, two domains`,
    )
  }
})

test.serial('activeVisitors match and count the visitors of the last seconds', async (t) => {
  for (const record of liveRecords(context.ids[0])) {
    await dual.addRecord(record)
  }

  await flush()

  const current = createDate('UTC')
  const expected = await mongo.activeVisitors(context.ids, current)

  t.is(await clickhouse.activeVisitors(context.ids, current), expected)
  t.is(expected, 4)
  t.is(
    await clickhouse.activeVisitors(context.ids, dateDetails()),
    await mongo.activeVisitors(context.ids, dateDetails()),
  )
  t.is(await clickhouse.activeVisitors(['unknown'], current), 0)
})

for (const type of ['TOTAL', 'AVERAGE']) {
  test.serial(`actions chart ${type} matches for every interval, limit and time zone`, async (t) => {
    await assertSameIntervals(t, 'actionsChart', [eventId], (interval, limit) => [type, interval, limit], type)
  })

  test.serial(`actions list ${type} matches for every sorting, range and limit`, async (t) => {
    for (const range of ranges) {
      await assertSameGrouped(
        t,
        'actionsList',
        [eventId],
        SORTINGS_TOP,
        (limit) => [SORTINGS_TOP, type, range, limit],
        `actions TOP ${type} ${range}`,
      )
    }

    const range = rangeConstants.RANGES_LAST_7_DAYS

    await assertSameGrouped(
      t,
      'actionsList',
      [eventId],
      SORTINGS_RECENT,
      (limit) => [SORTINGS_RECENT, type, range, limit],
      `actions RECENT ${type}`,
    )

    await assertSameGrouped(
      t,
      'actionsList',
      [eventId],
      SORTINGS_NEW,
      (limit) => [SORTINGS_NEW, type, range, limit],
      `actions NEW ${type}`,
    )
  })
}

test.serial('actions are empty for an unknown event', async (t) => {
  const chart = [['unknown'], 'TOTAL', INTERVALS_DAILY, 7, dateDetails()]
  const list = [['unknown'], SORTINGS_TOP, 'TOTAL', rangeConstants.RANGES_LAST_7_DAYS, 30, dateDetails()]

  t.deepEqual(await clickhouse.actionsChart(...chart), await mongo.actionsChart(...chart))
  t.deepEqual(await clickhouse.actionsList(...list), [])
  t.deepEqual(await mongo.actionsList(...list), [])
})
