import test from 'ava'

import cachedLookup from '../../src/utils/cachedLookup.js'

// A lookup whose answers the test gives one by one, in the order the calls were made
const createLookup = () => {
  const calls = []

  const lookup = (key) =>
    new Promise((resolve, reject) => {
      calls.push({ key, resolve, reject })
    })

  return { calls, lookup }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('looks a key up once while it is fresh', async (t) => {
  let clock = 0
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30, () => clock)

  const first = cached('a')
  calls[0].resolve({ id: 'a' })
  t.deepEqual(await first, { id: 'a' })

  clock = 29
  t.deepEqual(await cached('a'), { id: 'a' })
  t.is(calls.length, 1)
})

test('callers of an unknown key share one lookup and wait for it', async (t) => {
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30)

  const both = Promise.all([cached('a'), cached('a')])
  calls[0].resolve({ id: 'a' })
  const [first, second] = await both

  t.is(first, second)
  t.is(calls.length, 1)
})

test('a stale value is served at once while one lookup refreshes it', async (t) => {
  let clock = 0
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30, () => clock)

  const first = cached('a')
  calls[0].resolve({ title: 'old' })
  await first

  clock = 30
  t.deepEqual(await cached('a'), { title: 'old' })
  t.deepEqual(await cached('a'), { title: 'old' })
  t.is(calls.length, 2)

  calls[1].resolve({ title: 'new' })
  await settle()

  t.deepEqual(await cached('a'), { title: 'new' })
  t.is(calls.length, 2)
})

test('a refresh that finds nothing drops the value', async (t) => {
  let clock = 0
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30, () => clock)

  const first = cached('a')
  calls[0].resolve({ id: 'a' })
  await first

  clock = 30
  await cached('a')
  calls[1].resolve(null)
  await settle()

  const next = cached('a')
  t.is(calls.length, 3)
  calls[2].resolve(null)
  t.is(await next, null)
})

test('a failed refresh keeps the value and the next call tries again', async (t) => {
  let clock = 0
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30, () => clock)

  const first = cached('a')
  calls[0].resolve({ id: 'a' })
  await first

  clock = 30
  await cached('a')
  calls[1].reject(new Error('MongoDB is away'))
  await settle()

  t.deepEqual(await cached('a'), { id: 'a' })
  t.is(calls.length, 3)

  calls[2].resolve({ id: 'a', title: 'back' })
  await settle()
  t.deepEqual(await cached('a'), { id: 'a', title: 'back' })
})

test('nothing found and a failure are not kept for a key without a value', async (t) => {
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30)

  const gone = cached('gone')
  calls[0].resolve(null)
  t.is(await gone, null)

  const broken = cached('broken')
  calls[1].reject(new Error('MongoDB is away'))
  await t.throwsAsync(broken, { message: 'MongoDB is away' })

  cached('gone')
  cached('broken').catch(() => {})
  t.deepEqual(
    calls.map(({ key }) => key),
    ['gone', 'broken', 'gone', 'broken'],
  )
})

test('a forgotten key is looked up afresh, and a lookup from before is not kept', async (t) => {
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30)

  const first = cached('a')
  calls[0].resolve({ key: 'old' })
  await first

  // A lookup under way when the key changed
  cached.forget('a')
  const during = cached('a')
  cached.forget('a')
  const after = cached('a')

  calls[2].resolve({ key: 'new' })
  calls[1].resolve({ key: 'old' })

  t.deepEqual(await during, { key: 'old' })
  t.deepEqual(await after, { key: 'new' })
  t.deepEqual(await cached('a'), { key: 'new' })
  t.is(calls.length, 3)
})

test('a value expired for more than another ttl is not served, the call waits for a fresh one', async (t) => {
  let clock = 0
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30, () => clock)

  const first = cached('a')
  calls[0].resolve({ key: 'old' })
  await first

  // Still served just before 2 × ttl
  clock = 59
  t.deepEqual(await cached('a'), { key: 'old' })
  calls[1].resolve({ key: 'old' })
  await settle()

  // Refreshed at 59, so it expires at 89 and is too old from 119 on
  clock = 119
  const waiting = cached('a')
  let answered
  waiting.then((value) => (answered = value))
  await settle()
  t.is(answered, undefined)

  calls[2].resolve({ key: 'new' })
  t.deepEqual(await waiting, { key: 'new' })
  t.is(calls.length, 3)
})

test('a failed lookup of a value that old reaches the caller', async (t) => {
  let clock = 0
  const { calls, lookup } = createLookup()
  const cached = cachedLookup(lookup, 30, () => clock)

  const first = cached('a')
  calls[0].resolve({ key: 'old' })
  await first

  clock = 60
  const waiting = cached('a')
  calls[1].reject(new Error('MongoDB is away'))
  await t.throwsAsync(waiting, { message: 'MongoDB is away' })
})
