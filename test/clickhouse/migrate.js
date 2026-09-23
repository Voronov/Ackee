import test from 'ava'
import mockedEnv from 'mocked-env'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { run as migrate } from '../../scripts/migrate-to-clickhouse.js'
import { run as seed } from '../../scripts/seed-records.js'
import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import { anonymize } from '../../src/database/records.js'
import Action from '../../src/models/Action.js'
import Record from '../../src/models/Record.js'
import connect from '../../src/utils/connect.js'
import { day } from '../../src/utils/times.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const restore = mockedEnv({ ACKEE_CLICKHOUSE_DATABASE: database })

const mongoDb = MongoMemoryServer.create()

const now = Date.parse('2026-09-21T12:00:00.000Z')
const records = 20000
const days = 10
const actions = 5
const tiedDomainId = 'tied'

const anonymizedFields = [
  'siteLanguage',
  'screenWidth',
  'screenHeight',
  'screenColorDepth',
  'deviceName',
  'deviceManufacturer',
  'osName',
  'osVersion',
  'browserName',
  'browserVersion',
  'browserWidth',
  'browserHeight',
]

const query = async (sql, parameters) => {
  const result = await getClient().query({
    query: sql,
    query_params: { database, ...parameters },
    format: 'JSONEachRow',
  })
  return result.json()
}

const command = (sql, parameters) => getClient().command({ query: sql, query_params: { database, ...parameters } })

const count = async (table, final = true) => {
  const [row] = await query(
    `SELECT count() AS count FROM {database:Identifier}.{table:Identifier} ${final === true ? 'FINAL' : ''}`,
    {
      table,
    },
  )
  return Number(row.count)
}

const optimize = (table) => command('OPTIMIZE TABLE {database:Identifier}.{table:Identifier} FINAL', { table })

const duplicates = (table) =>
  query('SELECT id, count() AS count FROM {database:Identifier}.{table:Identifier} GROUP BY id HAVING count > 1', {
    table,
  })

const countsPerDayInClickHouse = async () => {
  const rows = await query(
    `
      SELECT toString(toDate(created, 'UTC')) AS day, count() AS count
      FROM {database:Identifier}.records FINAL
      GROUP BY day
      ORDER BY day
    `,
    {},
  )
  return rows.map(({ day, count }) => ({ day, count: Number(count) }))
}

const countsPerDayInMongo = async () => {
  const rows = await Record.aggregate([
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  return rows.map(({ _id, count }) => ({ day: _id, count }))
}

const readRecord = async (id) => {
  const [row] = await query(
    `
      SELECT
        id,
        clientId,
        siteLocation,
        siteReferrer,
        ${anonymizedFields.join(',\n        ')},
        toString(toUnixTimestamp64Milli(created)) AS created,
        toString(toUnixTimestamp64Milli(updated)) AS updated,
        toString(version) AS version
      FROM {database:Identifier}.records FINAL
      WHERE id = {id:String}
    `,
    { id },
  )
  return row
}

const readAction = async (id) => {
  const [row] = await query(
    `
      SELECT id, eventId, key, value, details, toString(toUnixTimestamp64Milli(updated)) AS updated, toString(version) AS version
      FROM {database:Identifier}.actions FINAL
      WHERE id = {id:String}
    `,
    { id },
  )
  return row
}

const checkpoint = () => mongoose.connection.collection('migrations').findOne({ id: 'clickhouse' })

const truncate = async () => {
  await command('TRUNCATE TABLE {database:Identifier}.records', {})
  await command('TRUNCATE TABLE {database:Identifier}.actions', {})
  await mongoose.connection.collection('migrations').deleteMany({})
}

test.before(async (t) => {
  await connect((await mongoDb).getUri())
  await ensureSchema(database)

  await seed({ records, days, seed: 42, batch: 5000, now, dryRun: false })

  const visitors = await Record.distinct('clientId')
  t.context.anonymizedIds = []

  for (const clientId of visitors.slice(0, 3)) {
    const ids = await Record.distinct('id', { clientId })
    await anonymize(clientId, 'none')
    t.context.anonymizedIds.push(...ids)
  }

  await Action.insertMany(
    Array.from({ length: actions }, (_, index) => ({
      eventId: 'event',
      key: `Key ${index}`,
      value: index,
      details: index % 2 === 0 ? 'Details' : undefined,
      created: new Date(now - index * day),
      updated: new Date(now - index * day + 1000),
    })),
  )
})

test.after.always(async () => {
  await command('DROP DATABASE IF EXISTS {database:Identifier}', {})
  await close()
  await mongoose.disconnect()
  await (await mongoDb).stop()
  restore()
})

test.beforeEach(truncate)

test.afterEach.always(() => Record.deleteMany({ domainId: tiedDomainId }))

test.serial('migrates every record and action with the same per-day counts as MongoDB', async (t) => {
  const result = await migrate({ batch: 10000, reset: false, dryRun: false })

  t.deepEqual(result, {
    migrated: { records, actions },
    stopped: false,
    partial: false,
    counts: { records: { mongo: records, clickhouse: records }, actions: { mongo: actions, clickhouse: actions } },
  })

  t.is(await Record.countDocuments({}), records)
  t.is(await count('records'), records)
  t.is(await count('actions'), actions)

  const perDay = await countsPerDayInMongo()
  t.is(perDay.length, days + 1)
  t.deepEqual(await countsPerDayInClickHouse(), perDay)

  const mongoRecord = await Record.findOne({ clientId: { $ne: null } }).lean()
  const clickhouseRecord = await readRecord(mongoRecord.id)

  t.is(clickhouseRecord.clientId, mongoRecord.clientId)
  t.is(clickhouseRecord.siteLocation, mongoRecord.siteLocation)
  t.is(clickhouseRecord.siteReferrer, mongoRecord.siteReferrer ?? null)
  t.is(clickhouseRecord.browserName, mongoRecord.browserName)
  t.is(clickhouseRecord.screenWidth, mongoRecord.screenWidth)
  t.is(clickhouseRecord.created, String(mongoRecord.created.getTime()))
  t.is(clickhouseRecord.updated, String(mongoRecord.updated.getTime()))
  t.is(clickhouseRecord.version, String(mongoRecord.updated.getTime()))

  for (const mongoAction of await Action.find({}).lean()) {
    t.deepEqual(await readAction(mongoAction.id), {
      id: mongoAction.id,
      eventId: 'event',
      key: mongoAction.key,
      value: mongoAction.value,
      details: mongoAction.details ?? null,
      updated: String(mongoAction.updated.getTime()),
      version: String(mongoAction.updated.getTime()),
    })
  }
})

test.serial('migrates nothing on a second run and leaves no duplicates', async (t) => {
  await migrate({ batch: 10000, reset: false, dryRun: false })
  const result = await migrate({ batch: 10000, reset: false, dryRun: false })

  t.deepEqual(result.migrated, { records: 0, actions: 0 })
  t.is(await count('records'), records)

  await optimize('records')
  await optimize('actions')

  t.is(await count('records', false), records)
  t.is(await count('actions', false), actions)
  t.deepEqual(await duplicates('records'), [])
  t.deepEqual(await duplicates('actions'), [])
})

test.serial('continues from the checkpoint after an interrupted run', async (t) => {
  const first = await migrate({ batch: 1000, reset: false, dryRun: false, stopAfter: 2 })

  t.true(first.stopped)
  t.true(first.partial)
  t.deepEqual(first.migrated, { records: 2000, actions: 0 })
  t.is(await count('records'), 2000)
  t.is(await count('actions'), 0)

  const position = await checkpoint()
  const last = await Record.findOne({ created: position.records.created, _id: position.records._id }).lean()
  t.not(last, null)
  t.is(position.actions, undefined)

  const second = await migrate({ batch: 1000, reset: false, dryRun: false })

  t.false(second.stopped)
  t.false(second.partial)
  t.deepEqual(second.migrated, { records: records - 2000, actions })
  t.is(await count('records'), records)
  t.is(await count('actions'), actions)

  await optimize('records')

  t.is(await count('records', false), records)
  t.deepEqual(await duplicates('records'), [])
})

test.serial('migrates everything again after --reset without creating duplicates', async (t) => {
  await migrate({ batch: 10000, reset: false, dryRun: false })
  const result = await migrate({ batch: 10000, reset: true, dryRun: false })

  t.deepEqual(result.migrated, { records, actions })
  t.is(await count('records'), records)

  await optimize('records')

  t.is(await count('records', false), records)
  t.deepEqual(await duplicates('records'), [])
})

test.serial('starts from --from, ignores the checkpoint and does not save one', async (t) => {
  await migrate({ batch: 10000, reset: false, dryRun: false })
  await truncate()

  const from = now - 3 * day
  const expected = await Record.countDocuments({ created: { $gte: new Date(from) } })
  const result = await migrate({ batch: 10000, reset: false, dryRun: false, from })

  t.true(expected > 0)
  t.true(expected < records)
  t.deepEqual(result.migrated, { records: expected, actions: 4 })
  t.true(result.partial)
  t.deepEqual(result.counts, {
    records: { mongo: records, clickhouse: expected },
    actions: { mongo: actions, clickhouse: 4 },
  })
  t.is(await count('records'), expected)
  t.is(await checkpoint(), null)

  const [older] = await query(
    'SELECT count() AS count FROM {database:Identifier}.records WHERE created < fromUnixTimestamp64Milli({from:Int64})',
    { from },
  )
  t.is(Number(older.count), 0)
})

test.serial('stops after the last batch even when it is the final partial one', async (t) => {
  const result = await migrate({ batch: 7000, reset: false, dryRun: false, stopAfter: 3 })

  t.true(result.stopped)
  t.deepEqual(result.migrated, { records, actions: 0 })
  t.is(await count('actions'), 0)
})

test.serial('continues past a checkpoint that ties on created without losing or duplicating documents', async (t) => {
  const created = new Date(now - 20 * day)
  const tied = Array.from({ length: 7 }, () => ({
    id: uuid(),
    clientId: 'tied',
    domainId: tiedDomainId,
    siteLocation: 'https://example.com/tied/',
    created,
    updated: created,
  }))
  await Record.insertMany(tied)

  const first = await migrate({ batch: 2, reset: false, dryRun: false, stopAfter: 1 })

  t.true(first.stopped)
  t.deepEqual(first.migrated, { records: 2, actions: 0 })

  const position = await checkpoint()
  t.is(position.records.created.getTime(), created.getTime())

  const second = await migrate({ batch: 10000, reset: false, dryRun: false })

  t.false(second.stopped)
  t.deepEqual(second.migrated, { records: records + 5, actions })

  await optimize('records')

  t.is(await count('records', false), records + 7)
  t.deepEqual(await duplicates('records'), [])

  const rows = await query(
    'SELECT id FROM {database:Identifier}.records FINAL WHERE domainId = {domainId:String} ORDER BY id',
    { domainId: tiedDomainId },
  )
  t.deepEqual(
    rows.map(({ id }) => id),
    tied.map(({ id }) => id).toSorted(),
  )
})

test.serial('stores anonymized records with an empty clientId and the same null fields as MongoDB', async (t) => {
  await migrate({ batch: 10000, reset: false, dryRun: false })

  t.true(t.context.anonymizedIds.length > 0)

  for (const id of t.context.anonymizedIds) {
    const mongoRecord = await Record.findOne({ id }).lean()
    const clickhouseRecord = await readRecord(id)

    t.is(mongoRecord.clientId, null)
    t.is(clickhouseRecord.clientId, '')
    t.is(clickhouseRecord.siteLocation, mongoRecord.siteLocation)

    for (const field of anonymizedFields) {
      t.is(mongoRecord[field], null, field)
      t.is(clickhouseRecord[field], null, field)
    }
  }
})

test.serial('writes nothing and keeps the checkpoint on a dry run', async (t) => {
  const result = await migrate({ batch: 10000, reset: false, dryRun: true })

  t.deepEqual(result, { migrated: { records, actions }, stopped: false })
  t.is(await count('records', false), 0)
  t.is(await count('actions', false), 0)
  t.is(await checkpoint(), null)
})
