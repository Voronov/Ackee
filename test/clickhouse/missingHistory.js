import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'

import { close, getClient } from '../../src/clickhouse/client.js'
import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { flush } from '../../src/stores/clickhouse/writer.js'
import { connectEventStore } from '../../src/stores/connect.js'
import * as dual from '../../src/stores/dual/index.js'
import signale from '../../src/utils/signale.js'
import { cleanup, connectToDatabase } from '../resolvers/_utils.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const domainId = 'domain'

// Not restored: the store is switched per test to cover both modes
mockedEnv({ ACKEE_CLICKHOUSE_DATABASE: database })

const original = signale.warn
const warnings = []

const connectWithStore = async (eventStore) => {
  const restore = mockedEnv({ ACKEE_EVENT_STORE: eventStore })

  warnings.length = 0
  signale.warn = (message) => warnings.push(message)

  try {
    await connectEventStore()
  } finally {
    signale.warn = original
    restore()
  }

  return warnings
}

const recordInput = (index) => ({
  clientId: `client-${index}`,
  domainId,
  siteLocation: 'https://example.com/',
})

test.before(connectToDatabase)

test.after.always(async () => {
  await getClient().command({ query: 'DROP DATABASE IF EXISTS {database:Identifier}', query_params: { database } })
  await close()
  await cleanup(server)()
})

test.serial('warns when MongoDB holds records and ClickHouse does not', async (t) => {
  await Record.insertMany(Array.from({ length: 12 }, (_, index) => recordInput(index)))

  const [warning, ...rest] = await connectWithStore('clickhouse')

  t.deepEqual(rest, [])
  t.true(warning.includes('ClickHouse holds 0 records'))
  t.true(warning.includes('MongoDB holds about 12'))
  t.true(warning.includes('npm run clickhouse:migrate'))
})

test.serial('stays quiet in dual mode, where MongoDB still answers the reports', async (t) => {
  t.is(await Record.estimatedDocumentCount(), 12)
  t.deepEqual(await connectWithStore('dual'), [])
})

test.serial('stays quiet once the history has been migrated', async (t) => {
  const records = await Record.find({ domainId }).lean()

  await dual.mirrorRecords(records)
  await flush()

  const [row] = await getClient()
    .query({
      query: 'SELECT count() AS count FROM {database:Identifier}.records FINAL',
      query_params: { database },
      format: 'JSONEachRow',
    })
    .then((result) => result.json())

  t.is(Number(row.count), 12)
  t.deepEqual(await connectWithStore('clickhouse'), [])
})

test.serial('stays quiet when both stores are empty', async (t) => {
  await Record.deleteMany({ domainId })

  t.is(await Record.estimatedDocumentCount(), 0)
  t.deepEqual(await connectWithStore('clickhouse'), [])
})

// The comparison is a courtesy, so a store that cannot answer it must not stop the start
test.serial('logs and starts anyway when the comparison itself fails', async (t) => {
  const count = Record.estimatedDocumentCount

  Record.estimatedDocumentCount = () => Promise.reject(new Error('no connection'))

  try {
    const [warning, ...rest] = await connectWithStore('clickhouse')

    t.deepEqual(rest, [])
    t.true(warning.includes('Could not compare the record counts of MongoDB and ClickHouse'))
    t.true(warning.includes('no connection'))
  } finally {
    Record.estimatedDocumentCount = count
  }
})
