import test from 'ava'

import { stats as queueStats } from '../../src/queue/redis.js'
import { stats as workerStats } from '../../src/queue/worker.js'
import { apolloPlugin, handler, httpMiddleware, isEnabled, registry } from '../../src/utils/metrics.js'

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

// The Grafana dashboards (deploy/grafana) query these names and labels. A change of the client
// library (ACKEE-69) or a refactor must not rename a series by accident.
test('the series of Ackee keep their names, types and labels', (t) => {
  const own = registry
    .getMetricsAsArray()
    .filter((metric) => /^ackee_(?!nodejs_|process_)/.test(metric.name))
    .map((metric) => [metric.name, metric.type, [...metric.labelNames]])

  t.deepEqual(own, [
    ['ackee_http_request_duration_seconds', 'histogram', ['method', 'route', 'status']],
    ['ackee_graphql_operation_duration_seconds', 'histogram', ['operation', 'field', 'outcome']],
    ['ackee_mongodb_command_duration_seconds', 'histogram', ['command', 'collection', 'outcome']],
    ['ackee_ingest_queue_length', 'gauge', []],
    ['ackee_ingest_queue_oldest_age_seconds', 'gauge', []],
    ['ackee_ingest_queue_processed_total', 'counter', ['type']],
    ['ackee_ingest_queue_dropped_total', 'counter', ['reason']],
    ['ackee_ingest_fallback_total', 'counter', ['reason']],
    ['ackee_live_connections', 'gauge', []],
    ['ackee_live_watched_domains', 'gauge', []],
    ['ackee_live_polls_total', 'counter', ['outcome']],
    ['ackee_live_visits_sent_total', 'counter', []],
    ['ackee_live_rejected_total', 'counter', ['reason']],
  ])
})

test('the default series the dashboards use are still collected', (t) => {
  const names = new Set(registry.getMetricsAsArray().map((metric) => metric.name))

  for (const name of [
    'ackee_nodejs_eventloop_lag_p50_seconds',
    'ackee_nodejs_eventloop_lag_p90_seconds',
    'ackee_nodejs_eventloop_lag_p99_seconds',
    'ackee_nodejs_gc_duration_seconds',
    'ackee_nodejs_heap_size_total_bytes',
    'ackee_nodejs_heap_size_used_bytes',
    'ackee_nodejs_version_info',
    'ackee_process_cpu_seconds_total',
    'ackee_process_resident_memory_bytes',
    // File descriptors are read from /proc, so only Linux has them
    ...(process.platform === 'linux' ? ['ackee_process_open_fds', 'ackee_process_max_fds'] : []),
  ]) {
    t.true(names.has(name), name)
  }
})
