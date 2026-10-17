import { createClient } from '@redis/client'
import test from 'ava'
import mockedEnv from 'mocked-env'

import salt, { closeSharedSalt, createSharedSalt, job, rule } from '../../src/utils/salt.js'

test.after.always(() => {
  job.cancel()
})

// Behaves like Redis for the two commands the shared salt uses, with a clock the test moves
const createStore = () => {
  const values = new Map()
  let clock = 0

  return {
    values,
    tick: (seconds) => {
      clock += seconds
      for (const [key, entry] of values) if (entry.expires <= clock) values.delete(key)
    },
    client: {
      set: (key, value, { condition, expiration }) => {
        if (condition === 'NX' && values.has(key)) return Promise.resolve(null)
        values.set(key, { value, expires: clock + expiration.value })
        return Promise.resolve('OK')
      },
      get: (key) => Promise.resolve(values.get(key)?.value ?? null),
    },
  }
}

const day = (date) => () => new Date(`${date}T12:00:00`)

test('return same result as long as it is the same day', async (t) => {
  const a = await salt()
  const b = await salt()

  t.is(a, b)
})

test('generates a new salt once a day', (t) => {
  const afterMidnight = new Date(2026, 9, 18, 0, 0, 30)

  t.is(rule.nextInvocationDate(afterMidnight).getTime(), new Date(2026, 9, 19).getTime())
})

test('gives two processes the same salt on the same day', async (t) => {
  const { client } = createStore()

  const a = await createSharedSalt(client, day('2026-10-18'))()
  const b = await createSharedSalt(client, day('2026-10-18'))()

  t.is(a.length, 32)
  t.is(a, b)
})

test('keeps the salt when a process restarts during the day', async (t) => {
  const store = createStore()

  const before = await createSharedSalt(store.client, day('2026-10-18'))()
  store.tick(6 * 60 * 60)
  const after = await createSharedSalt(store.client, day('2026-10-18'))()

  t.is(before, after)
})

test('gives the next day another salt and forgets the old one', async (t) => {
  const store = createStore()
  let today = '2026-10-18'
  const shared = createSharedSalt(store.client, () => day(today)())

  const first = await shared()
  today = '2026-10-19'
  const second = await shared()

  t.not(first, second)
  t.true(store.values.has('ackee:salt:2026-10-18'))
  store.tick(25 * 60 * 60)
  t.false(store.values.has('ackee:salt:2026-10-18'))
})

test.serial('rejects and connects anew when the Redis address is invalid', async (t) => {
  const restore = mockedEnv({ ACKEE_REDIS: 'invalid://redis' })
  t.teardown(restore)

  await t.throwsAsync(salt())
  await t.throwsAsync(salt())
  await t.notThrowsAsync(closeSharedSalt())
})

// Needs a Redis without data worth keeping: ACKEE_TEST_REDIS=redis://127.0.0.1:6379 npx ava test/utils/salt.js
const withRedis = process.env.ACKEE_TEST_REDIS == null ? test.skip : test.serial

withRedis('shares the salt through Redis', async (t) => {
  const restore = mockedEnv({ ACKEE_REDIS: process.env.ACKEE_TEST_REDIS })
  const client = createClient({ url: process.env.ACKEE_TEST_REDIS })
  await client.connect()

  t.teardown(async () => {
    restore()
    await client.quit()
    await closeSharedSalt()
  })

  const a = await salt()
  const b = await createSharedSalt(client)()
  const keys = await client.keys('ackee:salt:*')

  t.is(a, b)
  t.true((await client.ttl(keys[0])) > 24 * 60 * 60)
})
