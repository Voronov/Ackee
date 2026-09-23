import test from 'ava'
import { createClient } from '@clickhouse/client'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import aggregateDurations from '../../src/aggregations/aggregateDurations.js'
import aggregateTopRecords from '../../src/aggregations/aggregateTopRecords.js'
import aggregateViews from '../../src/aggregations/aggregateViews.js'
import { insert } from '../../src/clickhouse/records.js'
import { durations, topRecords, views } from '../../src/clickhouse/reports.js'
import { INTERVALS_DAILY } from '../../src/constants/intervals.js'
import { RANGES_LAST_30_DAYS } from '../../src/constants/ranges.js'
import Record from '../../src/models/Record.js'
import { getClient, migrate } from '../../src/utils/clickhouse.js'
import createDate from '../../src/utils/createDate.js'
import { job as saltJob } from '../../src/utils/salt.js'

// These only run when ClickHouse is actually up. Otherwise they are skipped: requiring it
// for every `npm test` would be too much to ask of a developer.
const URL = process.env.ACKEE_CLICKHOUSE
const DATABASE = 'ackee_parity_test'

const HOUR = 3_600_000
const mongoDb = MongoMemoryServer.create()
const domainId = uuid()

const pages = ['https://example.com/', 'https://example.com/a', 'https://example.com/b']
const referrers = ['https://google.com/', 'https://news.example/', null]
const browsers = ['Safari', 'Chrome']

test.before(async () => {
  if (URL == null) return

  // A separate database, so the working data is left alone.
  const bootstrap = createClient({
    url: URL,
    username: process.env.ACKEE_CLICKHOUSE_USER,
    password: process.env.ACKEE_CLICKHOUSE_PASSWORD,
  })
  await bootstrap.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` })
  await bootstrap.command({ query: `CREATE DATABASE ${DATABASE}` })
  await bootstrap.close()

  process.env.ACKEE_CLICKHOUSE_DATABASE = DATABASE
  process.env.ACKEE_CLICKHOUSE_READS = 'true'

  const { default: connect } = await import('../../src/utils/connect.js')
  await connect((await mongoDb).getUri())
  await migrate()

  const now = Date.now()

  // Records spread across days and hours, with some fields left empty: that is where the
  // presence conditions could differ between the two stores.
  const records = Array.from({ length: 300 }, (_, index) => {
    const created = new Date(now - index * 2 * HOUR)

    return {
      id: uuid(),
      clientId: `client-${index % 17}`,
      domainId,
      siteLocation: pages[index % pages.length],
      siteReferrer: referrers[index % referrers.length],
      source: index % 4 === 0 ? 'newsletter' : null,
      siteLanguage: index % 5 === 0 ? 'uk' : 'en',
      country: index % 3 === 0 ? 'UA' : 'DE',
      browserName: browsers[index % browsers.length],
      browserVersion: '140.0',
      osName: 'macOS',
      osVersion: '26.0',
      deviceManufacturer: 'Apple',
      deviceName: 'MacBook Pro',
      browserWidth: 1440,
      browserHeight: 900,
      screenWidth: 1920,
      screenHeight: 1080,
      screenColorDepth: 24,
      created,
      // Visit lengths from seconds to minutes, so the average is not trivial.
      updated: new Date(created.getTime() + (index % 13) * 20_000),
    }
  })

  await Record.insertMany(records)
  await insert(records)

  // Async inserts return before the rows land in the table.
  await getClient().command({ query: 'SYSTEM FLUSH ASYNC INSERT QUEUE' })
})

test.after.always(async () => {
  // Always stop it: MongoMemoryServer starts at module level, so it runs even when the
  // tests themselves are skipped. Without this ava never exits.
  if (URL != null) {
    await getClient().command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` })
    await getClient().close()
    await mongoose.disconnect()
  }

  await (await mongoDb).stop()
  saltJob.cancel()
})

const normalize = (entries) =>
  entries
    .map((entry) => ({ key: JSON.stringify(entry._id), count: Math.round(Number(entry.count) * 1000) / 1000 }))
    .toSorted((left, right) => left.key.localeCompare(right.key))

const dimensions = [
  { properties: ['siteLocation'] },
  { properties: ['source', 'siteReferrer'], or: true },
  { properties: ['siteReferrer'] },
  { properties: ['source'] },
  { properties: ['browserName'] },
  { properties: ['browserName', 'browserVersion'] },
  { properties: ['country'] },
  { properties: ['siteLanguage'] },
  { properties: ['screenWidth', 'screenHeight'] },
]

test('top reports from ClickHouse match MongoDB', async (t) => {
  if (URL == null) return t.pass('ClickHouse not configured, skipped')

  const dateDetails = createDate('Europe/Kyiv')
  const ids = [domainId]

  for (const { properties, or = false } of dimensions) {
    const mongo = await Record.aggregate(aggregateTopRecords(ids, properties, RANGES_LAST_30_DAYS, 30, dateDetails, or))
    const columnar = await topRecords(ids, properties, RANGES_LAST_30_DAYS, 30, dateDetails, or)

    t.not(columnar, null, `dimension ${properties.join('|')} should have come from ClickHouse`)
    t.deepEqual(normalize(columnar), normalize(mongo), `dimension ${properties.join('|')} disagrees`)
  }
})

test('views from ClickHouse match MongoDB', async (t) => {
  if (URL == null) return t.pass('ClickHouse not configured, skipped')

  const ids = [domainId]

  for (const timeZone of ['Europe/Kyiv', 'UTC', 'America/New_York']) {
    const dateDetails = createDate(timeZone)

    const mongo = await Record.aggregate(aggregateViews(ids, false, INTERVALS_DAILY, 30, dateDetails))
    const columnar = await views(ids, INTERVALS_DAILY, 30, dateDetails)

    t.not(columnar, null, `${timeZone}: views should have come from ClickHouse`)
    t.deepEqual(normalize(columnar), normalize(mongo), `${timeZone}: views disagree`)
  }
})

// This report is why the columnar store exists (ADR-004), so it is checked separately and
// with a tolerance for floating-point error.
test('durations from ClickHouse match MongoDB', async (t) => {
  if (URL == null) return t.pass('ClickHouse not configured, skipped')

  const dateDetails = createDate('Europe/Kyiv')
  const ids = [domainId]

  const mongo = await Record.aggregate(aggregateDurations(ids, INTERVALS_DAILY, 30, dateDetails))
  const columnar = await durations(ids, INTERVALS_DAILY, 30, dateDetails)

  t.not(columnar, null)
  t.is(columnar.length, mongo.length)

  const byKey = new Map(mongo.map((entry) => [JSON.stringify(entry._id), entry.count]))

  for (const entry of columnar) {
    const expected = byKey.get(JSON.stringify(entry._id))

    t.not(expected, undefined, `group ${JSON.stringify(entry._id)} is missing in MongoDB`)
    t.true(Math.abs(Number(entry.count) - expected) < 1, `duration disagrees for ${JSON.stringify(entry._id)}`)
  }
})
