import test from 'ava'
import mockedEnv from 'mocked-env'

import { close, enqueue, ping } from '../../src/queue/redis.js'

// The same port the ClickHouse unreachable tests use: nothing listens there
const restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'redis', ACKEE_REDIS_URL: 'redis://localhost:1' })

test.after.always(async () => {
  await close()
  restore()
})

test.serial('ping rejects with the address and the reason, which is what stops the startup', async (t) => {
  await t.throwsAsync(ping, {
    message: 'Redis at redis://localhost:1 is unreachable: ECONNREFUSED',
  })
})

test.serial('enqueue rejects at once instead of queueing the event in memory', async (t) => {
  const error = await t.throwsAsync(() => enqueue('record.touch', { id: 'r1' }))

  t.regex(error.message, /Stream isn't writeable|Connection is closed/)
})
