import test from 'ava'

import {
  apolloPlugin,
  handler,
  httpMiddleware,
  isEnabled,
  observeRollupBuild,
  registry,
  setRollupLag,
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

test.serial('rollup metrics are recorded only while enabled', async (t) => {
  delete process.env.ACKEE_METRICS_TOKEN
  observeRollupBuild('backfill', 1)
  setRollupLag(42)

  process.env.ACKEE_METRICS_TOKEN = 'secret'
  observeRollupBuild('refresh', 2)
  setRollupLag(7)

  const output = await registry.metrics()

  t.true(output.includes('mode="refresh"'))
  t.false(output.includes('mode="backfill"'))
  t.true(output.includes('ackee_rollup_lag_seconds{app="ackee"} 7'))
})
