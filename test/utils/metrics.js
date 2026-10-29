import test from 'ava'

import { stats as queueStats } from '../../src/queue/redis.js'
import { stats as workerStats } from '../../src/queue/worker.js'
import {
  MAXIMUM_PENDING_COMMANDS,
  apolloPlugin,
  handler,
  httpMiddleware,
  instrumentMongo,
  isEnabled,
  registry,
} from '../../src/utils/metrics.js'

const fakeResponse = () => {
  const listeners = []

  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    listeners,
    status(code) {
      this.statusCode = code
      return this
    },
    send(body) {
      this.body = body
      return this
    },
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(body) {
      this.body = body
    },
    on(event, listener) {
      if (event === 'finish') listeners.push(listener)
    },
    finish() {
      for (const listener of listeners) listener()
    },
  }
}

test.serial('off without a token', async (t) => {
  delete process.env.ACKEE_METRICS_TOKEN

  t.false(isEnabled())

  const target = fakeResponse()
  await handler({ headers: {} }, target)

  // 404 rather than 401: the endpoint must not confirm that it exists.
  t.is(target.statusCode, 404)
})

test.serial('a wrong token also gets a 404', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const target = fakeResponse()
  await handler({ headers: { authorization: 'Bearer wrong' } }, target)

  t.is(target.statusCode, 404)
})

test.serial('the right token returns metrics', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const target = fakeResponse()
  await handler({ headers: { authorization: 'Bearer secret' } }, target)

  t.is(target.statusCode, 200)
  t.is(target.headers['Content-Type'], registry.contentType)
  t.true(target.body.includes('ackee_'))
})

test.serial('the route label comes from originalUrl, not path', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const target = fakeResponse()
  let called = false

  // Express rewrites req.url inside a mounted handler, so by the finish event req.path is
  // relative to the mount point. That is why the label is taken earlier.
  httpMiddleware({ method: 'POST', originalUrl: '/api?x=1', path: '/' }, target, () => {
    called = true
  })
  target.finish()

  t.true(called)
  t.true((await registry.metrics()).includes('route="/api"'))
})

test.serial('an unknown route collapses into other', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const target = fakeResponse()
  httpMiddleware({ method: 'GET', originalUrl: '/some/unknown/path', path: '/some/unknown/path' }, target, () => {})
  target.finish()

  t.true((await registry.metrics()).includes('route="other"'))
})

test.serial('the Apollo plugin measures by root field', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const hooks = await apolloPlugin.requestDidStart()

  await hooks.didResolveOperation({
    operation: { operation: 'query', selectionSet: { selections: [{ name: { value: 'domain' } }] } },
  })
  await hooks.willSendResponse({})

  t.true((await registry.metrics()).includes('field="domain"'))
})

test.serial('the plugin stays quiet while metrics are off', async (t) => {
  delete process.env.ACKEE_METRICS_TOKEN

  t.deepEqual(await apolloPlugin.requestDidStart(), {})
})

const lineOf = async (series) => (await registry.metrics()).split('\n').find((line) => line.startsWith(`${series} `))

test.serial('without the queue its series are there and stay at zero', async (t) => {
  delete process.env.ACKEE_INGEST_QUEUE

  t.is(await lineOf('ackee_ingest_queue_length{app="ackee"}'), 'ackee_ingest_queue_length{app="ackee"} 0')
  t.is(
    await lineOf('ackee_ingest_queue_oldest_age_seconds{app="ackee"}'),
    'ackee_ingest_queue_oldest_age_seconds{app="ackee"} 0',
  )
  t.truthy(await lineOf('ackee_ingest_queue_processed_total{type="record.touch",app="ackee"}'))
  t.truthy(await lineOf('ackee_ingest_queue_dropped_total{reason="unknown_record",app="ackee"}'))
  t.truthy(await lineOf('ackee_ingest_fallback_total{reason="full",app="ackee"}'))
})

test.serial('the counters of the queue report what the worker and the API counted', async (t) => {
  const restore = [workerStats.processed, workerStats.dropped, queueStats.fallback].map((counters) => {
    const before = { ...counters }
    return () => {
      for (const key of Object.keys(counters)) delete counters[key]
      Object.assign(counters, before)
    }
  })
  t.teardown(() => {
    for (const undo of restore) undo()
  })

  workerStats.processed['record.create'] = 7
  workerStats.dropped.invalid = 2
  queueStats.fallback.unavailable = 3

  t.is(
    await lineOf('ackee_ingest_queue_processed_total{type="record.create",app="ackee"}'),
    'ackee_ingest_queue_processed_total{type="record.create",app="ackee"} 7',
  )
  t.is(
    await lineOf('ackee_ingest_queue_dropped_total{reason="invalid",app="ackee"}'),
    'ackee_ingest_queue_dropped_total{reason="invalid",app="ackee"} 2',
  )
  t.is(
    await lineOf('ackee_ingest_fallback_total{reason="unavailable",app="ackee"}'),
    'ackee_ingest_fallback_total{reason="unavailable",app="ackee"} 3',
  )
})

test.serial('the series of the live feed are there before the first stream', async (t) => {
  t.is(await lineOf('ackee_live_connections{app="ackee"}'), 'ackee_live_connections{app="ackee"} 0')
  t.is(await lineOf('ackee_live_watched_domains{app="ackee"}'), 'ackee_live_watched_domains{app="ackee"} 0')
  t.is(await lineOf('ackee_live_visits_sent_total{app="ackee"}'), 'ackee_live_visits_sent_total{app="ackee"} 0')
  t.truthy(await lineOf('ackee_live_polls_total{outcome="gap",app="ackee"}'))
  t.truthy(await lineOf('ackee_live_rejected_total{reason="workspace_limit",app="ackee"}'))

  // No label could name a workspace or a domain
  const text = await registry.metrics()
  t.false(/ackee_live_[a-z_]+{[^}]*(domain|workspace)Id/.test(text))
})

test.serial('a live stream is left out of the request durations', (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const target = fakeResponse()
  let called = false

  httpMiddleware({ method: 'GET', originalUrl: '/api/live?domainId=x', path: '/api/live' }, target, () => {
    called = true
  })

  t.true(called)
  t.is(target.listeners.length, 0)
})

test.serial('a document with several root fields is one series, multiple', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  const hooks = await apolloPlugin.requestDidStart()
  await hooks.didResolveOperation({
    operation: {
      operation: 'query',
      selectionSet: {
        selections: [{ name: { value: 'domains' } }, { name: { value: 'events' } }, { name: { value: 'domains' } }],
      },
    },
  })
  await hooks.willSendResponse({})

  const text = await registry.metrics()
  t.true(text.includes('field="multiple"'))
  // Not the combination: a client could mint a series per subset of the schema
  t.false(text.includes('field="domains,events"'))
})

test.serial('commands the driver never finishes do not pile up', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'secret'

  // The driver as the code sees it: something to listen to
  const listeners = {}
  const client = { on: (name, listener) => (listeners[name] = listener), emit: (name, event) => listeners[name](event) }
  instrumentMongo(client)

  const series =
    'ackee_mongodb_command_duration_seconds_count{app="ackee",command="find",collection="pending",outcome="ok"}'
  const before = await lineOf(series)

  for (let id = 1; id <= MAXIMUM_PENDING_COMMANDS + 1; id++) {
    client.emit('commandStarted', { requestId: id, commandName: 'find', command: { find: 'pending' } })
  }

  // The oldest was dropped to make room, so its late finish counts nothing
  client.emit('commandSucceeded', { requestId: 1 })
  t.is(await lineOf(series), before)

  // A command still remembered is measured as usual
  client.emit('commandSucceeded', { requestId: MAXIMUM_PENDING_COMMANDS + 1 })
  t.not(await lineOf(series), before)
})
