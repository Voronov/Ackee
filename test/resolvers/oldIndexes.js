import test from 'ava'
import listen from 'test-listen'

import { dropOldRecordIndexes } from '../../src/database/migrations.js'
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

test.serial('a database without records yet is left alone', async (t) => {
  await Record.collection.drop()

  t.false(await dropOldRecordIndexes())
})
