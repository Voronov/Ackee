import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'

import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const query = async (sql, parameters) => {
  const result = await getClient().query({ query: sql, query_params: parameters, format: 'JSONEachRow' })
  return result.json()
}

const command = (sql, parameters) => getClient().command({ query: sql, query_params: parameters })

const insert = (table, values) => getClient().insert({ table: `${database}.${table}`, values, format: 'JSONEachRow' })

const describeTable = async (table) => {
  const rows = await query('DESCRIBE TABLE {database:Identifier}.{table:Identifier}', { database, table })
  return rows.map(({ name, type }) => ({ name, type }))
}

const showCreateTable = async (table) => {
  const [row] = await query('SHOW CREATE TABLE {database:Identifier}.{table:Identifier}', { database, table })
  return row.statement
}

const tableInfo = async (table) => {
  const [row] = await query(
    `
      SELECT engine, partition_key, sorting_key
      FROM system.tables
      WHERE database = {database:String} AND name = {table:String}
    `,
    { database, table },
  )
  return row
}

const record = (overrides) => ({
  id: uuid(),
  clientId: 'client',
  domainId: 'domain',
  siteLocation: 'https://example.com/',
  siteReferrer: null,
  siteLanguage: 'en',
  source: null,
  screenWidth: 1920,
  screenHeight: 1080,
  screenColorDepth: 24,
  deviceName: null,
  deviceManufacturer: null,
  osName: 'macOS',
  osVersion: '15',
  browserName: 'Safari',
  browserVersion: '18',
  browserWidth: 1400,
  browserHeight: 900,
  created: '2026-01-15 12:00:00.000',
  updated: '2026-01-15 12:00:00.000',
  version: 1,
  ...overrides,
})

const action = (overrides) => ({
  id: uuid(),
  eventId: 'event',
  key: 'plan',
  value: 1,
  details: null,
  created: '2026-01-15 12:00:00.000',
  updated: '2026-01-15 12:00:00.000',
  version: 1,
  ...overrides,
})

test.before(async () => {
  await ensureSchema(database)
})

test.after.always(async () => {
  await command('DROP DATABASE IF EXISTS {database:Identifier}', { database })
  await close()
})

test('ensureSchema can run twice without failing', async (t) => {
  await t.notThrowsAsync(() => ensureSchema(database))
})

test('creates the records table with all Record fields and a version', async (t) => {
  t.deepEqual(await describeTable('records'), [
    { name: 'id', type: 'String' },
    { name: 'clientId', type: 'String' },
    { name: 'domainId', type: 'String' },
    { name: 'siteLocation', type: 'String' },
    { name: 'siteReferrer', type: 'Nullable(String)' },
    { name: 'siteLanguage', type: 'LowCardinality(Nullable(String))' },
    { name: 'country', type: 'LowCardinality(Nullable(String))' },
    { name: 'source', type: 'Nullable(String)' },
    { name: 'screenWidth', type: 'Nullable(UInt32)' },
    { name: 'screenHeight', type: 'Nullable(UInt32)' },
    { name: 'screenColorDepth', type: 'Nullable(UInt32)' },
    { name: 'deviceName', type: 'LowCardinality(Nullable(String))' },
    { name: 'deviceManufacturer', type: 'LowCardinality(Nullable(String))' },
    { name: 'osName', type: 'LowCardinality(Nullable(String))' },
    { name: 'osVersion', type: 'LowCardinality(Nullable(String))' },
    { name: 'browserName', type: 'LowCardinality(Nullable(String))' },
    { name: 'browserVersion', type: 'LowCardinality(Nullable(String))' },
    { name: 'browserWidth', type: 'Nullable(UInt32)' },
    { name: 'browserHeight', type: 'Nullable(UInt32)' },
    { name: 'created', type: 'DateTime64(3)' },
    { name: 'updated', type: 'DateTime64(3)' },
    { name: 'version', type: 'UInt64' },
  ])
})

test('creates the actions table with all Action fields and a version', async (t) => {
  t.deepEqual(await describeTable('actions'), [
    { name: 'id', type: 'String' },
    { name: 'eventId', type: 'String' },
    { name: 'key', type: 'Nullable(String)' },
    { name: 'value', type: 'Nullable(Float64)' },
    { name: 'details', type: 'Nullable(String)' },
    { name: 'created', type: 'DateTime64(3)' },
    { name: 'updated', type: 'DateTime64(3)' },
    { name: 'version', type: 'UInt64' },
  ])
})

test('replaces records by version, partitioned and ordered by domain and time', async (t) => {
  t.deepEqual(await tableInfo('records'), {
    engine: 'ReplacingMergeTree',
    partition_key: 'toYYYYMM(created)',
    sorting_key: 'domainId, created, id',
  })

  const statement = await showCreateTable('records')
  t.true(statement.includes('ENGINE = ReplacingMergeTree(version)'), statement)
})

test('replaces actions by version, partitioned and ordered by event and time', async (t) => {
  t.deepEqual(await tableInfo('actions'), {
    engine: 'ReplacingMergeTree',
    partition_key: 'toYYYYMM(created)',
    sorting_key: 'eventId, created, id',
  })

  const statement = await showCreateTable('actions')
  t.true(statement.includes('ENGINE = ReplacingMergeTree(version)'), statement)
})

test('keeps only the latest version of a record with the same key', async (t) => {
  const id = uuid()

  await insert('records', [record({ id, version: 1 })])
  await insert('records', [record({ id, updated: '2026-01-15 12:05:00.000', clientId: '', version: 2 })])

  const rows = await query(
    `
      SELECT id, clientId, updated, version
      FROM {database:Identifier}.records FINAL
      WHERE id = {id:String}
    `,
    { database, id },
  )

  t.deepEqual(rows, [{ id, clientId: '', updated: '2026-01-15 12:05:00.000', version: 2 }])
})

test('keeps only the latest version of an action with the same key', async (t) => {
  const id = uuid()

  await insert('actions', [action({ id, version: 1 })])
  await insert('actions', [action({ id, updated: '2026-01-15 12:05:00.000', value: 2, version: 2 })])

  const rows = await query(
    `
      SELECT id, value, updated, version
      FROM {database:Identifier}.actions FINAL
      WHERE id = {id:String}
    `,
    { database, id },
  )

  t.deepEqual(rows, [{ id, value: 2, updated: '2026-01-15 12:05:00.000', version: 2 }])
})

test('keeps clientId after a merge, there is no column TTL', async (t) => {
  const id = uuid()
  const statement = await showCreateTable('records')

  t.false(statement.includes('TTL'), statement)

  await insert('records', [record({ id, clientId: 'client', created: '2020-01-15 12:00:00.000' })])
  await command('OPTIMIZE TABLE {database:Identifier}.records FINAL', { database })

  const rows = await query(
    `
      SELECT clientId
      FROM {database:Identifier}.records FINAL
      WHERE id = {id:String}
    `,
    { database, id },
  )

  t.deepEqual(rows, [{ clientId: 'client' }])
})
