import { createClient } from '@redis/client'
import test from 'ava'
import mockedEnv from 'mocked-env'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

import { INGEST_GROUP, INGEST_STREAM } from '../../src/constants/ingest.js'
import { recordTouch } from '../../src/queue/messages.js'
import {
  adapter,
  checkConfig,
  close,
  describe,
  enqueue,
  fallbackReason,
  length,
  oldest,
  stats,
} from '../../src/queue/redis.js'
import { registry } from '../../src/utils/metrics.js'

// Refused at once, nothing listens on it
const UNREACHABLE = 'redis://127.0.0.1:1'

// Needs a Redis without data worth keeping: ACKEE_TEST_REDIS=redis://127.0.0.1:6379 npx ava test/queue/redis.js
// A database of its own, so the files that share the Redis do not see each other's stream.
const testRedis = () => {
  const url = new URL(process.env.ACKEE_TEST_REDIS)
  url.pathname = '/14'
  return url.href
}

const withRedis = process.env.ACKEE_TEST_REDIS == null ? test.skip : test.serial

const metric = async (name) => {
  const lines = (await registry.metrics()).split('\n')
  return lines.find((line) => line.startsWith(name))
}

let restore

test.afterEach.always(async () => {
  restore?.()
  restore = undefined
  await close()
})

// A connection of the test's own, to look at the stream past the module under test
const inspect = async (t) => {
  const inspector = createClient({ url: testRedis() })
  await inspector.connect()
  await inspector.flushDb()
  t.teardown(() => inspector.destroy())

  restore = mockedEnv({ ACKEE_INGEST_QUEUE: testRedis() })

  return inspector
}

test.serial('the queue and the salt may not share a Redis', (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'redis://redis:6379/1', ACKEE_REDIS: 'redis://redis:6379' })
  t.throws(checkConfig, { message: /same Redis/ })
  restore()

  restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'redis://localhost:6380', ACKEE_REDIS: 'redis://127.0.0.1:6380/2' })
  t.throws(checkConfig, { message: /same Redis/ })
  restore()

  restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'redis://redis-queue:6379', ACKEE_REDIS: 'redis://redis:6379' })
  t.notThrows(checkConfig)
  restore()

  restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'redis://localhost:6380', ACKEE_REDIS: 'redis://localhost' })
  t.notThrows(checkConfig)
})

test.serial('a queue URL that is not one stops the start', (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: 'not a url' })
  t.throws(checkConfig)
})

test.serial('without the queue there is nothing to check', (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: '', ACKEE_REDIS: 'redis://redis:6379' })
  t.notThrows(checkConfig)
})

test('the URL in the log has no credentials', (t) => {
  t.is(describe('redis://ackee:secret@redis:6379/1'), 'redis://redis:6379/1')
  t.is(describe('redis://:secret@redis:6379'), 'redis://redis:6379')
})

test('a full Redis is told apart from one that is away', (t) => {
  t.is(fallbackReason(new Error("OOM command not allowed when used memory > 'maxmemory'.")), 'full')
  t.is(fallbackReason(new Error('The client is offline')), 'unavailable')
  // How Node reports a refused connection
  t.is(fallbackReason({ message: '', code: 'ECONNREFUSED' }), 'unavailable')
})

test.serial('an unreachable queue turns the event away at once and counts why', async (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: UNREACHABLE })
  const before = stats.fallback.unavailable ?? 0
  const started = Date.now()

  t.false(await enqueue(recordTouch('record-id', Date.now())))
  t.false(await enqueue(recordTouch('record-id', Date.now())))

  t.true(Date.now() - started < 2000)
  t.is(stats.fallback.unavailable, before + 2)
  await t.throwsAsync(oldest())
  await t.throwsAsync(length())
})

test.serial('a scrape does not fail while the queue is unreachable', async (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: UNREACHABLE })

  t.regex(await metric('ackee_ingest_queue_length'), / 0$/)
  t.regex(await metric('ackee_ingest_queue_oldest_age_seconds'), / 0$/)
  t.regex(await metric('ackee_ingest_fallback_total{reason="unavailable"'), / \d+$/)
})

// Answers the commands of the connection handshake, never the ones that touch the stream:
// a Redis that is up but stuck, as with CLIENT PAUSE or a long DEBUG SLEEP
const startStuckRedis = async (t) => {
  const stuck = new Set(['XADD', 'XLEN', 'XRANGE'])

  const server = net.createServer((socket) => {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString()

      // Requests are arrays of bulk strings: *<n>, then $<length> and the value for each
      for (;;) {
        const lines = buffer.split('\r\n')
        const count = Number(lines[0]?.slice(1))
        if (lines.length < 2 * count + 2) return

        buffer = lines.slice(2 * count + 1).join('\r\n')
        if (stuck.has(lines[2].toUpperCase()) === false) socket.write('+OK\r\n')
      }
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.teardown(() => server.close())

  return `redis://127.0.0.1:${server.address().port}`
}

test.serial('a Redis that is up but stuck turns the event away after the deadline', async (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: await startStuckRedis(t) })
  const before = stats.fallback.unavailable ?? 0

  let started = Date.now()
  t.false(await enqueue(recordTouch('record-id', Date.now())))
  t.true(Date.now() - started < 1200)
  t.is(stats.fallback.unavailable, before + 1)

  started = Date.now()
  await t.throwsAsync(length(), { message: /No answer from the ingest queue within 1000 ms/ })
  await t.throwsAsync(oldest(), { message: /No answer/ })
  t.true(Date.now() - started < 2400)
})

withRedis('the group is created once and starts with what is already in the stream', async (t) => {
  const inspector = await inspect(t)
  const queue = adapter()

  t.true(await enqueue(recordTouch('record-id', 1000)))
  await queue.createGroup()
  await queue.createGroup()

  const [group] = await inspector.xInfoGroups(INGEST_STREAM)
  t.is(group.name, INGEST_GROUP)

  const entries = await queue.read('host', 10, null)
  t.is(entries.length, 1)
  t.deepEqual(entries[0].fields, recordTouch('record-id', 1000))
})

withRedis('an acknowledged entry is gone from the stream', async (t) => {
  const inspector = await inspect(t)
  const queue = adapter()

  await queue.createGroup()
  await enqueue(recordTouch('a', 1000))
  await enqueue(recordTouch('b', 2000))

  const entries = await queue.read('host', 10, null)
  t.is(await queue.deliveries(entries[0].id), 1)

  await queue.ack([entries[0].id])
  await queue.ack([])

  t.is(await inspector.xLen(INGEST_STREAM), 1)
  t.is((await inspector.xPending(INGEST_STREAM, INGEST_GROUP)).pending, 1)
  t.is(await queue.deliveries(entries[0].id), 0)
})

withRedis('a read waits for new entries only when asked to', async (t) => {
  await inspect(t)
  const queue = adapter()
  await queue.createGroup()

  let started = Date.now()
  t.deepEqual(await queue.read('host', 10, null), [])
  t.true(Date.now() - started < 100)

  started = Date.now()
  t.deepEqual(await queue.read('host', 10, 200), [])
  t.true(Date.now() - started >= 150)
})

withRedis('entries a consumer left behind are claimed after they were idle long enough', async (t) => {
  await inspect(t)
  const queue = adapter()

  await queue.createGroup()
  await enqueue(recordTouch('a', 1000))
  await queue.read('gone', 10, null)

  t.deepEqual(await queue.claim('host', 60_000, 10), [])

  await sleep(20)
  const [entry] = await queue.claim('host', 10, 10)

  t.is(entry.fields.data, recordTouch('a', 1000).data)
  t.is(await queue.deliveries(entry.id), 2)
})

withRedis('a consumer reads back what it holds, after a given id', async (t) => {
  await inspect(t)
  const queue = adapter()

  await queue.createGroup()
  for (const id of ['a', 'b', 'c']) await enqueue(recordTouch(id, 1000))
  const [first, second, third] = await queue.read('host', 10, null)
  await queue.ack([first.id])

  t.deepEqual(
    (await queue.own('host', 10, '0')).map((entry) => entry.id),
    [second.id, third.id],
  )
  t.deepEqual(
    (await queue.own('host', 10, second.id)).map((entry) => entry.id),
    [third.id],
  )
  t.deepEqual(await queue.own('other', 10, '0'), [])
})

withRedis('only consumers that are gone and hold nothing are forgotten', async (t) => {
  const inspector = await inspect(t)
  const queue = adapter()

  await queue.createGroup()
  await enqueue(recordTouch('a', 1000))
  await enqueue(recordTouch('b', 1000))

  const [done] = await queue.read('gone', 1, null)
  await queue.ack([done.id])
  await queue.read('busy', 1, null)
  await queue.read('host', 1, null)
  await sleep(20)

  t.deepEqual(await queue.prune('host', 60_000), [])
  t.deepEqual(await queue.prune('host', 10), ['gone'])

  const names = (await inspector.xInfoConsumers(INGEST_STREAM, INGEST_GROUP)).map((consumer) => consumer.name)
  t.deepEqual(names.toSorted(), ['busy', 'host'])
})

withRedis('the oldest waiting event and the length of the queue', async (t) => {
  await inspect(t)
  const queue = adapter()

  t.is(await oldest(), null)
  t.is(await length(), 0)
  t.regex(await metric('ackee_ingest_queue_oldest_age_seconds'), / 0$/)

  await queue.createGroup()
  await enqueue(recordTouch('a', 1000))
  await enqueue(recordTouch('b', 2000))

  t.deepEqual(await oldest(), new Date(1000))
  t.is(await length(), 2)
  t.regex(await metric('ackee_ingest_queue_length'), / 2$/)
  t.true(Number((await metric('ackee_ingest_queue_oldest_age_seconds')).split(' ')[1]) > 1000)

  const [first] = await queue.read('host', 1, null)
  await queue.ack([first.id])

  t.deepEqual(await oldest(), new Date(2000))
  t.is(await length(), 1)
  t.regex(await metric('ackee_ingest_queue_length'), / 1$/)

  // Redis goes away: the scrape still answers, with the last length it knew
  await close()
  restore()
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: UNREACHABLE })

  t.regex(await metric('ackee_ingest_queue_length'), / 1$/)
})

withRedis('an entry without a time counts from when it was added', async (t) => {
  const inspector = await inspect(t)
  const before = Date.now()

  await inspector.xAdd(INGEST_STREAM, '*', { v: '1' })

  const since = await oldest()
  t.true(since.getTime() >= before - 1000)
  t.true(since.getTime() <= Date.now())
})
