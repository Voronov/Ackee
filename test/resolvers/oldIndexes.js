import test from 'ava'
import listen from 'test-listen'

import { dropOldActionIndexes, dropOldRecordIndexes } from '../../src/database/migrations.js'
import Action from '../../src/models/Action.js'
import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { cleanup, connectToDatabase } from './_utils.js'

listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

const indexNames = async () => (await Record.collection.indexes()).map((index) => index.name)

test.serial('the old domainId index is dropped at start', async (t) => {
  // The schema indexes first, as on a real start
  await Record.init()
  // Left behind by a version from before the compound index
  await Record.collection.createIndex({ domainId: 1 })
  t.true((await indexNames()).includes('domainId_1'))

  t.true(await dropOldRecordIndexes())

  const names = await indexNames()
  t.false(names.includes('domainId_1'))
  t.true(names.includes('domainId_1_created_1'))
})

test.serial('a second start finds nothing to drop', async (t) => {
  t.false(await dropOldRecordIndexes())
})

test.serial('processes that start together drop the index once and keep running', async (t) => {
  await Record.collection.createIndex({ domainId: 1 })

  // The api, ingest and worker processes on the same old database
  const results = await Promise.all([dropOldRecordIndexes(), dropOldRecordIndexes(), dropOldRecordIndexes()])

  t.true(results.includes(true))
  t.false((await indexNames()).includes('domainId_1'))
})

test.serial('a database without records yet is left alone', async (t) => {
  await Record.collection.drop()

  t.false(await dropOldRecordIndexes())
})

const actionIndexNames = async () => (await Action.collection.indexes()).map((index) => index.name)

test.serial('the old eventId index of actions is dropped at start', async (t) => {
  await Action.init()
  await Action.collection.createIndex({ eventId: 1 })
  t.true((await actionIndexNames()).includes('eventId_1'))

  t.true(await dropOldActionIndexes())

  const names = await actionIndexNames()
  t.false(names.includes('eventId_1'))
  t.true(names.includes('eventId_1_created_1'))
  // Nothing left the second time
  t.false(await dropOldActionIndexes())
})

test.serial('a database without actions yet is left alone', async (t) => {
  await Action.collection.drop()

  t.false(await dropOldActionIndexes())
})
