import test from 'ava'
import Redis from 'ioredis'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'

import {
  ack,
  claimStale,
  close,
  createGroup,
  deliveries,
  enqueue,
  group,
  length,
  ping,
  readBatch,
  refreshLength,
  stats,
} from '../../src/queue/redis.js'

const stream = `ackee:events:test:${uuid()}`

const restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'redis', ACKEE_REDIS_STREAM: stream })

// A second connection, so that the stream can be inspected and dropped independently
// of the module under test
const inspector = new Redis(process.env.ACKEE_REDIS_URL)

const pendingCount = async () => {
  const [count] = await inspector.xpending(stream, group)
  return count
}

test.before(async () => {
  await ping()
  await createGroup()
})

test.after.always(async () => {
  await close()
  await inspector.del(stream)
  await inspector.quit()
  restore()
})

test.serial('creating the group twice is not an error', async (t) => {
  await t.notThrowsAsync(createGroup)
})

test.serial('length is zero before anything was enqueued', async (t) => {
  t.is(await length(), 0)
})

test.serial('enqueue appends type and JSON payload, readBatch hands them to the consumer', async (t) => {
  const id = await enqueue('record.create', { id: 'r1', siteLocation: 'https://example.com/' })

  t.regex(id, /^\d+-\d+$/)
  t.is(await length(), 1)

  const messages = await readBatch('one', { count: 10, block: 10 })

  t.deepEqual(messages, [{ id, type: 'record.create', payload: '{"id":"r1","siteLocation":"https://example.com/"}' }])
  t.deepEqual(await readBatch('one', { count: 10, block: 10 }), [])
  t.is(await pendingCount(), 1)
  t.is(await deliveries(id), 1)
})

test.serial('ack removes the message from the pending list', async (t) => {
  const [[id]] = await inspector.xrange(stream, '-', '+')

  await ack([id])

  t.is(await pendingCount(), 0)
  t.is(await deliveries(id), 0)
  t.is(await length(), 0)
  t.is(await inspector.xlen(stream), 1)
})

test.serial('ack of nothing is a no-op', async (t) => {
  await t.notThrowsAsync(() => ack([]))
})

test.serial('claimStale hands unacknowledged messages of another consumer over and counts the delivery', async (t) => {
  const first = await enqueue('record.touch', { id: 'r1' })
  const second = await enqueue('record.touch', { id: 'r2' })

  const read = await readBatch('crashed', { count: 10, block: 10 })
  t.deepEqual(
    read.map((message) => message.id),
    [first, second],
  )

  t.deepEqual(await claimStale('alive', 60_000), [])

  const claimed = await claimStale('alive', 0)

  t.deepEqual(
    claimed.map((message) => message.id),
    [first, second],
  )
  t.is(claimed[0].type, 'record.touch')
  t.is(claimed[0].payload, '{"id":"r1"}')
  t.is(await deliveries(first), 2)
  t.is(await deliveries(second), 2)

  await ack([first, second])
  t.is(await pendingCount(), 0)
})

test.serial('readBatch respects count and leaves the rest for the next call', async (t) => {
  const ids = await Promise.all(Array.from({ length: 5 }, (_, index) => enqueue('action.touch', { id: `a${index}` })))

  const firstBatch = await readBatch('one', { count: 3, block: 10 })
  const secondBatch = await readBatch('one', { count: 3, block: 10 })

  t.deepEqual(
    firstBatch.map((message) => message.id),
    ids.slice(0, 3),
  )
  t.deepEqual(
    secondBatch.map((message) => message.id),
    ids.slice(3),
  )

  await ack(ids)
})

test.serial('length counts undelivered and unacknowledged messages, not acknowledged ones', async (t) => {
  const first = await enqueue('record.touch', { id: 'r3' })
  await enqueue('record.touch', { id: 'r4' })

  t.is(await length(), 2)

  await readBatch('one', { count: 1, block: 10 })
  t.is(await length(), 2)

  await ack([first])
  t.is(await length(), 1)
  t.is(await inspector.xlen(stream), 10)
})

test.serial('refreshLength publishes the backlog on the queue gauge', async (t) => {
  await refreshLength()

  t.is(stats.length, 1)
})
