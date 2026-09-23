import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import { flush, push, size, stats } from '../../src/stores/clickhouse/writer.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const restore = mockedEnv({ ACKEE_CLICKHOUSE_DATABASE: database })

const record = (domainId) => ({
  id: uuid(),
  clientId: 'client',
  domainId,
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
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  version: 1,
})

const countRecords = async (domainId) => {
  const result = await getClient().query({
    query: 'SELECT count() AS count FROM {database:Identifier}.records WHERE domainId = {domainId:String}',
    query_params: { database, domainId },
    format: 'JSONEachRow',
  })
  const [row] = await result.json()
  return Number(row.count)
}

const pollUntil = async (read, expected, deadline) => {
  let value

  for (let elapsed = 0; elapsed <= deadline; elapsed += 100) {
    value = await read()
    if (value === expected) return value
    await sleep(100)
  }

  return value
}

test.before(async () => {
  await ensureSchema(database)
})

test.after.always(async () => {
  await getClient().command({ query: 'DROP DATABASE IF EXISTS {database:Identifier}', query_params: { database } })
  await close()
  restore()
})

test.serial('inserts every pushed row once flush resolves', async (t) => {
  const domainId = uuid()

  for (let index = 0; index < 2500; index++) push('records', record(domainId))

  await flush()

  t.is(size(), 0)
  t.is(await countRecords(domainId), 2500)
})

test.serial('inserts a small batch on the timer without an explicit flush', async (t) => {
  const domainId = uuid()

  for (let index = 0; index < 10; index++) push('records', record(domainId))

  t.is(size(), 10)
  t.is(await pollUntil(() => countRecords(domainId), 10, 1500), 10)
  t.is(size(), 0)
})

test.serial('inserts rows of different tables from the same buffer', async (t) => {
  const domainId = uuid()
  const eventId = uuid()

  push('records', record(domainId))
  push('actions', {
    id: uuid(),
    eventId,
    key: 'plan',
    value: 1,
    details: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    version: 1,
  })

  await flush()

  const result = await getClient().query({
    query: 'SELECT key FROM {database:Identifier}.actions WHERE eventId = {eventId:String}',
    query_params: { database, eventId },
    format: 'JSONEachRow',
  })

  t.is(await countRecords(domainId), 1)
  t.deepEqual(await result.json(), [{ key: 'plan' }])
  t.deepEqual(stats, { errors: 0, dropped: 0 })
})
