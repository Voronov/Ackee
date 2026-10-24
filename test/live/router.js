import test from 'ava'
import express from 'express'
import mockedEnv from 'mocked-env'
import http from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import listen from 'test-listen'

import { ROLE_VIEWER } from '../../src/constants/roles.js'
import { DEFAULT_WORKSPACE_ID } from '../../src/constants/workspaces.js'
import { createHub } from '../../src/live/hub.js'
import { createRouter } from '../../src/live/router.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from '../resolvers/_utils.js'
import { openStream } from './_stream.js'

// A router of its own with short intervals, so the checks of an open stream happen within a test
const hub = createHub({ interval: 50 })
const router = createRouter({ hub, heartbeat: 100, recheck: 150 })
const app = express()
app.use(router)
const server = http.createServer(app)
const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

const view = (domainId, extra = {}) =>
  Record.create({ domainId, siteLocation: 'https://example.com/live', created: new Date(), ...extra })

test.serial('a stream is an event stream that proxies leave alone', async (t) => {
  const stream = await openStream(base, { token: t.context.token.id })
  t.teardown(stream.close)

  t.is(stream.status, 200)
  t.is(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  t.is(stream.headers.get('cache-control'), 'no-cache, no-transform')
  t.is(stream.headers.get('x-accel-buffering'), 'no')

  t.truthy(await stream.waitFor((entry) => entry.retry === '5000'))
  t.truthy(await stream.waitFor((entry) => entry.event === 'comment' && entry.data === 'ping'))
})

test.serial('a reconnect with Last-Event-ID gets only what it missed', async (t) => {
  const first = await openStream(base, { token: t.context.token.id, domainId: t.context.domain.id })

  await view(t.context.domain.id, { siteLocation: 'https://example.com/one' })
  const seen = await first.waitFor((entry) => entry.event === 'visit')
  await first.close()

  // Another viewer keeps the domain watched while the first one is away
  const other = await openStream(base, { token: t.context.token.id, domainId: t.context.domain.id })
  t.teardown(other.close)
  await view(t.context.domain.id, { siteLocation: 'https://example.com/two' })
  await other.waitFor((entry) => entry.event === 'visit' && entry.data.siteLocation === 'https://example.com/two')

  const again = await openStream(base, {
    token: t.context.token.id,
    domainId: t.context.domain.id,
    headers: { 'Last-Event-ID': seen.id },
  })
  t.teardown(again.close)

  const missed = await again.waitFor((entry) => entry.event === 'visit')
  t.is(missed.data.siteLocation, 'https://example.com/two')
  await sleep(100)
  t.deepEqual(
    again.visits().map((entry) => entry.siteLocation),
    ['https://example.com/two'],
  )
})

test.serial('a deleted token ends the stream', async (t) => {
  const stream = await openStream(base, { token: t.context.token.id })
  const before = router.stats.rejected.unauthorized ?? 0

  await Token.deleteOne({ id: t.context.token.id })

  const end = await stream.waitFor((entry) => entry.event === 'end')
  t.deepEqual(end.data, { reason: 'unauthorized' })
  await stream.ended()
  t.true(stream.isEnded())
  t.is(router.stats.rejected.unauthorized, before + 1)
})

test.serial('a lost membership ends the stream', async (t) => {
  const stream = await openStream(base, { token: t.context.token.id })

  await Membership.deleteMany({ userId: t.context.user.id })

  const end = await stream.waitFor((entry) => entry.event === 'end')
  t.deepEqual(end.data, { reason: 'forbidden' })
})

test.serial('a stream of all domains stops showing a workspace once its membership is gone', async (t) => {
  const other = await Domain.create({ title: 'Other workspace', workspaceId: 'second-workspace' })
  await Membership.create({ userId: t.context.user.id, workspaceId: 'second-workspace', role: ROLE_VIEWER })
  t.teardown(() => Domain.deleteOne({ id: other.id }))

  const stream = await openStream(base, { token: t.context.token.id })
  t.teardown(stream.close)

  await view(other.id, { siteLocation: 'https://example.com/before' })
  t.truthy(await stream.waitFor((entry) => entry.event === 'visit' && entry.data.domainId === other.id))

  await Membership.deleteOne({ userId: t.context.user.id, workspaceId: 'second-workspace' })
  // Past the next check, which takes the domain of that workspace away
  await sleep(250)

  await view(other.id, { siteLocation: 'https://example.com/after' })
  await view(t.context.domain.id, { siteLocation: 'https://example.com/still-mine' })

  t.truthy(await stream.waitFor((entry) => entry.event === 'visit' && entry.data.siteLocation.endsWith('/still-mine')))
  // A few more ticks for the view that must not come
  await sleep(200)
  t.false(stream.visits().some((entry) => entry.siteLocation === 'https://example.com/after'))
  t.false(stream.isEnded())
})

test.serial('a deleted domain ends the stream of that domain', async (t) => {
  const stream = await openStream(base, { token: t.context.token.id, domainId: t.context.domain.id })

  await Domain.deleteOne({ id: t.context.domain.id })

  const end = await stream.waitFor((entry) => entry.event === 'end')
  t.deepEqual(end.data, { reason: 'unknown_domain' })
})

test.serial('a stream of all domains picks up a domain added while it is open', async (t) => {
  const stream = await openStream(base, { token: t.context.token.id })
  t.teardown(stream.close)

  const added = await Domain.create({ title: 'Added', workspaceId: DEFAULT_WORKSPACE_ID })
  t.teardown(() => Domain.deleteOne({ id: added.id }))

  // After the next check the new domain is watched as well
  await sleep(250)
  await view(added.id, { siteLocation: 'https://example.com/added' })

  const entry = await stream.waitFor((item) => item.event === 'visit' && item.data.domainId === added.id)
  t.is(entry.data.siteLocation, 'https://example.com/added')
})

test.serial('the limit of the process answers 429 with Retry-After', async (t) => {
  const restore = mockedEnv({ ACKEE_LIVE_CONNECTIONS: '1' })
  t.teardown(restore)

  const first = await openStream(base, { token: t.context.token.id })
  t.teardown(first.close)
  const second = await openStream(base, { token: t.context.token.id })

  t.is(second.status, 429)
  t.is(second.headers.get('retry-after'), '30')
  t.true(router.stats.rejected.process_limit >= 1)
})

test.serial('the limit of a workspace answers 429 while the process has room', async (t) => {
  const restore = mockedEnv({ ACKEE_LIVE_WORKSPACE_CONNECTIONS: '1' })
  t.teardown(restore)

  const first = await openStream(base, { token: t.context.token.id, domainId: t.context.domain.id })
  t.teardown(first.close)
  const second = await openStream(base, { token: t.context.token.id })

  t.is(second.status, 429)
  t.is(second.text, 'Too many live streams for this workspace')

  // Closing a stream gives its slot back
  await first.close()
  await sleep(50)
  const third = await openStream(base, { token: t.context.token.id })
  t.teardown(third.close)
  t.is(third.status, 200)
})

test.serial('ACKEE_LIVE_CONNECTIONS=0 turns the feed off', async (t) => {
  const restore = mockedEnv({ ACKEE_LIVE_CONNECTIONS: '0' })
  t.teardown(restore)

  const stream = await openStream(base, { token: t.context.token.id })

  t.is(stream.status, 404)
  t.is(stream.text, 'Not found')
})

test.serial('closed streams give their slots back', async (t) => {
  const streams = await Promise.all(Array.from({ length: 3 }, () => openStream(base, { token: t.context.token.id })))
  t.is(router.stats.connections, 3)

  await Promise.all(streams.map((stream) => stream.close()))
  await sleep(50)

  t.is(router.stats.connections, 0)
  t.is(hub.watched(), 0)
})

test.serial('a client that does not read is dropped instead of buffered for', async (t) => {
  // Far more than the socket takes, so the rest has to wait in the process
  const large = Array.from({ length: 400 }, (_, index) => ({
    key: `k${index}`,
    domainId: 'domain',
    siteLocation: `https://example.com/${'x'.repeat(64 * 1024)}`,
    created: new Date(),
  }))
  const stuck = { subscribe: () => ({ backlog: large, update() {}, close() {} }) }

  const slowApp = express()
  const slowRouter = createRouter({ hub: stuck })
  slowApp.use(slowRouter)
  const slowServer = http.createServer(slowApp)
  t.teardown(() => slowServer.close())
  const url = new URL('/api/live', await listen(slowServer))

  // The server may drop it before the headers are read, so an error counts as an answer too
  const outcome = await new Promise((resolve) => {
    const request = http.get(url, { headers: { Authorization: `Bearer ${t.context.token.id}` } }, (response) => {
      response.on('error', () => {})
      // Never reads
      response.pause()
      resolve(response)
    })
    request.on('error', resolve)
  })
  t.teardown(() => outcome.destroy?.())

  for (let attempt = 0; attempt < 100 && slowRouter.stats.connections > 0; attempt++) await sleep(20)

  t.is(slowRouter.stats.connections, 0)
  t.true(slowRouter.stats.sent < large.length)
})

test.serial('a full tick reaches a client that reads, even when it is larger than the limit', async (t) => {
  let handlers
  const ticking = {
    subscribe: (domainIds, next) => {
      handlers = next
      return { backlog: [], update() {}, close() {} }
    },
  }

  const tickApp = express()
  const tickRouter = createRouter({ hub: ticking })
  tickApp.use(tickRouter)
  const tickServer = http.createServer(tickApp)
  t.teardown(() => tickServer.close())

  const stream = await openStream(listen(tickServer), { token: t.context.token.id })
  t.teardown(stream.close)
  await stream.waitFor((entry) => entry.retry != null)

  // About 240 KB in one turn of the event loop, as a full batch with long URLs and a gap
  const created = new Date()
  for (let index = 0; index < 200; index++) {
    handlers.visit({ key: `k${index}`, siteLocation: `https://example.com/${'x'.repeat(1000)}`, created })
  }
  handlers.gap()

  t.truthy(await stream.waitFor((entry) => entry.event === 'gap'))
  t.is(stream.visits().length, 200)
  t.false(stream.isEnded())
  t.is(tickRouter.stats.connections, 1)
})

test.serial('a client that has not read since the last pack is dropped when the next one starts', async (t) => {
  // Over the limit, but well within what one pack may add
  const backlog = Array.from({ length: 100 }, (_, index) => ({
    key: `k${index}`,
    domainId: 'domain',
    siteLocation: `https://example.com/${'x'.repeat(1024)}`,
    created: new Date(),
  }))
  let handlers
  const hub = {
    subscribe: (domainIds, next) => {
      handlers = next
      return { backlog, update() {}, close() {} }
    },
  }

  // How much the client is behind. The kernel takes megabytes from a paused client on loopback,
  // so pausing it alone would not leave anything in the buffer of the process.
  const behind = { bytes: undefined }
  const packApp = express()
  packApp.use((request, response, next) => {
    const real = Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, 'writableLength')
    Object.defineProperty(response, 'writableLength', { get: () => behind.bytes ?? real.get.call(response) })
    next()
  })
  const packRouter = createRouter({ hub })
  packApp.use(packRouter)
  const packServer = http.createServer(packApp)
  t.teardown(() => packServer.close())

  const stream = await openStream(listen(packServer), { token: t.context.token.id })
  t.teardown(stream.close)

  // The whole first pack goes out, although it is larger than the limit
  await stream.waitFor((entry) => entry.data?.key === 'k99')
  t.is(packRouter.stats.sent, backlog.length)
  t.is(packRouter.stats.connections, 1)

  // Still 100 KB of it unread when the next tick writes
  behind.bytes = 100 * 1024
  handlers.gap()

  for (let attempt = 0; attempt < 100 && packRouter.stats.connections > 0; attempt++) await sleep(20)
  t.is(packRouter.stats.connections, 0)
  t.true(await stream.ended().then(() => true))
})
