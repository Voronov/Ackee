import test from 'ava'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

import { job as saltJob } from '../../src/utils/salt.js'

const mongoDb = await MongoMemoryServer.create()

let ready

test.after.always(async () => {
  // The module also runs a migration once connected, and disconnecting under it would reject it
  await ready
  await mongoose.disconnect()
  await mongoDb.stop()
  saltJob.cancel()
})

test('a serverless deployment says that it has no live feed, so the UI does not retry', async (t) => {
  // The module connects on import, so the address has to be there first
  process.env.ACKEE_MONGODB = mongoDb.getUri()
  const { handler, ready: started } = await import('../../src/serverless.js')
  ready = started

  const response = await handler(new Request('http://localhost/api/live', { headers: { Authorization: 'Bearer x' } }))

  t.is(response.status, 404)
  t.is(await response.text(), 'The live feed is not available in serverless deployments')
  t.is(response.headers.get('content-type'), 'text/plain; charset=utf-8')
})
