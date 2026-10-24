import test from 'ava'
import { setTimeout as sleep } from 'node:timers/promises'

import { LIVE_POLL_ERROR, LIVE_POLL_GAP, LIVE_POLL_OK } from '../../src/constants/live.js'
import { createHub } from '../../src/live/hub.js'

const visit = (key, domainId, created) => ({ key, domainId, siteLocation: 'https://example.com/', created })

// Stands in for MongoDB: returns what the test put there, newer than `since` and newest first,
// as records.live does, and notes every call
const fakeFind = (views = []) => {
  const calls = []

  const find = (domainIds, since, limit) => {
    calls.push({ domainIds: [...domainIds].toSorted(), since })

    return views
      .filter((entry) => domainIds.includes(entry.domainId) && entry.created > since)
      .toSorted((a, b) => b.created - a.created)
      .slice(0, limit)
  }

  return { find, calls, views }
}

const listener = () => {
  const received = []
  const gaps = []

  return { received, gaps, handlers: { visit: (entry) => received.push(entry), gap: () => gaps.push(true) } }
}

test('ten viewers cost one query per tick, whatever they watch', async (t) => {
  const { find, calls } = fakeFind()
  const hub = createHub({ find, interval: 30 })

  const subscriptions = Array.from({ length: 10 }, (_, index) =>
    hub.subscribe([`domain-${index % 5}`], listener().handlers),
  )

  await sleep(200)
  for (const subscription of subscriptions) subscription.close()

  // One call for all of them on every tick: ten would be at least ten per tick
  t.true(calls.length >= 3)
  t.true(calls.length <= Math.ceil(200 / 30) + 1)
  t.is(calls.length, hub.stats.polls[LIVE_POLL_OK])
  for (const call of calls) t.deepEqual(call.domainIds, ['domain-0', 'domain-1', 'domain-2', 'domain-3', 'domain-4'])
})

test('every view is delivered once, and only to the viewers of its domain', async (t) => {
  const now = Date.now()
  const { find } = fakeFind([visit('a', 'one', new Date(now - 1000)), visit('b', 'two', new Date(now - 500))])
  const hub = createHub({ find, interval: 20 })

  const first = listener()
  const second = listener()
  const one = hub.subscribe(['one'], first.handlers)
  const two = hub.subscribe(['two'], second.handlers)

  // Several ticks, each of which finds both views again in its window
  await sleep(120)
  one.close()
  two.close()

  t.deepEqual(
    first.received.map((entry) => entry.key),
    ['a'],
  )
  t.deepEqual(
    second.received.map((entry) => entry.key),
    ['b'],
  )
})

test('a view that arrives late, older than those already sent, still reaches the viewer', async (t) => {
  const now = Date.now()
  const { find, views } = fakeFind([visit('newer', 'one', new Date(now - 100))])
  const hub = createHub({ find, interval: 20 })
  const { received, handlers } = listener()
  const subscription = hub.subscribe(['one'], handlers)

  await sleep(60)
  // Written by the queue a few seconds after it happened
  views.push(visit('older', 'one', new Date(now - 5000)))
  await sleep(60)
  subscription.close()

  t.deepEqual(
    received.map((entry) => entry.key),
    ['newer', 'older'],
  )
})

test('the poller stops with the last viewer and starts again with the next', async (t) => {
  const { find, calls } = fakeFind()
  const hub = createHub({ find, interval: 20 })

  const subscription = hub.subscribe(['one'], listener().handlers)
  t.is(hub.watched(), 1)
  await sleep(60)
  subscription.close()
  t.is(hub.watched(), 0)

  const stopped = calls.length
  await sleep(80)
  t.is(calls.length, stopped)

  const again = hub.subscribe(['one'], listener().handlers)
  await sleep(10)
  again.close()
  t.true(calls.length > stopped)
})

test('ticks never overlap, even when MongoDB is slower than the interval', async (t) => {
  let running = 0
  let most = 0

  const find = async () => {
    running += 1
    most = Math.max(most, running)
    await sleep(50)
    running -= 1
    return []
  }

  const hub = createHub({ find, interval: 5 })
  const subscription = hub.subscribe(['one'], listener().handlers)

  // A second viewer and a change of domains while a tick waits must not start another loop
  await sleep(10)
  const other = hub.subscribe(['two'], listener().handlers)
  other.update(['three'])
  await sleep(150)
  subscription.close()
  other.close()

  t.is(most, 1)
})

test('a new viewer gets the recent views of the buffer at once, a reconnect only the newer ones', async (t) => {
  const now = Date.now()
  const views = Array.from({ length: 25 }, (_, index) => visit(`v${index}`, 'one', new Date(now - 10_000 + index)))
  const { find } = fakeFind(views)
  const hub = createHub({ find, interval: 20, bufferSize: 20 })

  const watcher = hub.subscribe(['one'], listener().handlers)
  await sleep(40)

  const fresh = hub.subscribe(['one'], listener().handlers)
  t.is(fresh.backlog.length, 20)
  t.is(fresh.backlog[0].key, 'v5')
  t.is(fresh.backlog.at(-1).key, 'v24')

  const reconnect = hub.subscribe(['one'], listener().handlers, views[21].created.getTime())
  t.deepEqual(
    reconnect.backlog.map((entry) => entry.key),
    ['v22', 'v23', 'v24'],
  )

  watcher.close()
  fresh.close()
  reconnect.close()
})

test('the buffer of a domain is forgotten a while after its last viewer left', async (t) => {
  let clock = Date.now()
  const { find } = fakeFind([visit('a', 'one', new Date(clock - 1000))])
  const hub = createHub({ find, interval: 20, grace: 1000, now: () => clock })

  const first = hub.subscribe(['one'], listener().handlers)
  await sleep(40)
  first.close()

  // Within the grace a reconnect still finds the view
  const soon = hub.subscribe(['one'], listener().handlers)
  t.is(soon.backlog.length, 1)
  soon.close()

  clock += 2000
  const later = hub.subscribe(['other'], listener().handlers)
  later.close()

  const after = hub.subscribe(['one'], listener().handlers)
  t.is(after.backlog.length, 0)
  after.close()
})

// Each call of the fake first adds the views of the next step, as if they came in since the last tick
const scripted = (steps) => {
  const fake = fakeFind()
  const find = (...args) => {
    fake.views.push(...(steps.shift() ?? []))
    return fake.find(...args)
  }

  return { ...fake, find }
}

test('a busy window is no gap while every tick reads all of its new views', async (t) => {
  const now = Date.now()
  let next = 0
  // Three new views per tick against a batch of five: the window soon holds far more than five
  const steps = Array.from({ length: 8 }, () =>
    Array.from({ length: 3 }, () => {
      next += 1
      return visit(`v${next}`, 'one', new Date(now - 10_000 + next))
    }),
  )
  const { find, calls } = scripted(steps)
  const hub = createHub({ find, interval: 10, batch: 5 })
  const viewer = listener()
  const subscription = hub.subscribe(['one'], viewer.handlers)

  for (let attempt = 0; attempt < 100 && calls.length < 9; attempt++) await sleep(10)
  subscription.close()

  t.deepEqual(viewer.gaps, [])
  t.is(hub.stats.polls[LIVE_POLL_GAP], undefined)
  t.is(viewer.received.length, 24)
  t.deepEqual(
    viewer.received.map((entry) => entry.key),
    Array.from({ length: 24 }, (_, index) => `v${index + 1}`),
  )
})

test('more new views than one batch reads are a gap for every viewer, the history before the first tick is not', async (t) => {
  const now = Date.now()
  const batchOf = (from, count) =>
    Array.from({ length: count }, (_, index) => visit(`v${from + index}`, 'one', new Date(now - 10_000 + from + index)))
  // Older views than fit when the first tick runs, then a burst, then calm
  const { find, calls } = scripted([batchOf(0, 5), batchOf(5, 5), batchOf(10, 1)])
  const hub = createHub({ find, interval: 20, batch: 3 })

  const viewer = listener()
  const bystander = listener()
  const one = hub.subscribe(['one'], viewer.handlers)
  const two = hub.subscribe(['two'], bystander.handlers)

  for (let attempt = 0; attempt < 100 && calls.length < 4; attempt++) await sleep(10)
  one.close()
  two.close()

  t.is(viewer.gaps.length, 1)
  t.is(bystander.gaps.length, 1)
  t.is(hub.stats.polls[LIVE_POLL_GAP], 1)
  // The newest of each tick, oldest first; v5 and v6 did not fit
  t.deepEqual(
    viewer.received.map((entry) => entry.key),
    ['v2', 'v3', 'v4', 'v7', 'v8', 'v9', 'v10'],
  )
  // Every tick reads the whole window, there is no cursor to fall behind with
  t.true(calls.every((call) => call.since.getTime() >= now - 16_000))
})

test('a viewer of several domains gets one gap per tick, not one per domain', async (t) => {
  const now = Date.now()
  const burst = (from, count) =>
    Array.from({ length: count }, (_, index) =>
      visit(`v${from + index}`, index % 2 === 0 ? 'one' : 'two', new Date(now - 10_000 + from + index)),
    )
  const { find, calls } = scripted([burst(0, 1), burst(1, 6), []])
  const hub = createHub({ find, interval: 20, batch: 3 })

  const viewer = listener()
  const subscription = hub.subscribe(['one', 'two', 'three'], viewer.handlers)

  for (let attempt = 0; attempt < 100 && calls.length < 3; attempt++) await sleep(10)
  subscription.close()

  t.is(hub.stats.polls[LIVE_POLL_GAP], 1)
  t.is(viewer.gaps.length, 1)
})

test('a domain that joins a running poller brings history, not a gap', async (t) => {
  const now = Date.now()
  // The second domain has older views in the window than fit next to those of the first
  const busy = Array.from({ length: 3 }, (_, index) => visit(`one-${index}`, 'one', new Date(now - 1000 + index)))
  const history = Array.from({ length: 5 }, (_, index) => visit(`two-${index}`, 'two', new Date(now - 5000 + index)))
  const { find, calls } = fakeFind([...busy, ...history])
  const hub = createHub({ find, interval: 20, batch: 4 })

  const first = listener()
  const one = hub.subscribe(['one'], first.handlers)
  for (let attempt = 0; attempt < 100 && calls.length < 2; attempt++) await sleep(5)

  const second = listener()
  const two = hub.subscribe(['two'], second.handlers)
  const joinedAt = calls.length
  for (let attempt = 0; attempt < 100 && calls.length < joinedAt + 2; attempt++) await sleep(5)
  one.close()
  two.close()

  // The batch after the join is full and its oldest view is of the new domain
  t.deepEqual(
    second.received.map((entry) => entry.key),
    ['two-4'],
  )
  t.deepEqual(first.gaps, [])
  t.deepEqual(second.gaps, [])
  t.is(hub.stats.polls[LIVE_POLL_GAP], undefined)
})

test('a new stream gets at most the newest hundred views of its buffers', async (t) => {
  const now = Date.now()
  const domains = Array.from({ length: 6 }, (_, index) => `domain-${index}`)
  const views = domains.flatMap((domainId, index) =>
    Array.from({ length: 20 }, (_, position) =>
      visit(`${domainId}-${position}`, domainId, new Date(now - 10_000 + position * 10 + index)),
    ),
  )
  const { find } = fakeFind(views)
  const hub = createHub({ find, interval: 20 })

  const watcher = hub.subscribe(domains, listener().handlers)
  await sleep(40)

  const fresh = hub.subscribe(domains, listener().handlers)
  watcher.close()
  fresh.close()

  const newest = views
    .toSorted((a, b) => a.created - b.created)
    .slice(-100)
    .map((entry) => entry.key)
  t.is(fresh.backlog.length, 100)
  t.deepEqual(
    fresh.backlog.map((entry) => entry.key),
    newest,
  )
})

test('a failing query is counted and retried on the next tick', async (t) => {
  let attempts = 0

  const find = () => {
    attempts += 1
    if (attempts <= 2) throw new Error('MongoDB is away')
    return []
  }

  const hub = createHub({ find, interval: 20 })
  const subscription = hub.subscribe(['one'], listener().handlers)

  await sleep(100)
  subscription.close()

  t.is(hub.stats.polls[LIVE_POLL_ERROR], 2)
  t.true(hub.stats.polls[LIVE_POLL_OK] >= 1)
})

test('a viewer whose domains change gets the views of the new ones and no longer those of the old', async (t) => {
  const now = Date.now()
  const { find, views } = fakeFind([visit('a', 'one', new Date(now - 1000))])
  const hub = createHub({ find, interval: 20 })
  const { received, handlers } = listener()

  const subscription = hub.subscribe(['one'], handlers)
  await sleep(40)

  subscription.update(['two'])
  t.is(hub.watched(), 1)

  views.push(visit('b', 'two', new Date(now - 500)), visit('c', 'one', new Date(now - 400)))
  await sleep(60)
  subscription.close()

  t.deepEqual(
    received.map((entry) => entry.key),
    ['a', 'b'],
  )
})

test('a view of a domain that lost its viewer while the query ran is left for the next one', async (t) => {
  const now = Date.now()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })

  const find = async () => {
    await gate
    return [visit('a', 'one', new Date(now - 1000))]
  }

  const hub = createHub({ find, interval: 20 })
  const subscription = hub.subscribe(['one'], listener().handlers)

  await sleep(10)
  subscription.close()
  release()
  await sleep(10)

  const { received, handlers } = listener()
  const next = hub.subscribe(['one'], handlers)
  await sleep(40)
  next.close()

  t.deepEqual(
    received.map((entry) => entry.key),
    ['a'],
  )
})
