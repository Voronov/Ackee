import test from 'ava'
import mockedEnv from 'mocked-env'

import * as clickhouse from '../../src/stores/clickhouse/index.js'
import * as dual from '../../src/stores/dual/index.js'
import { methods, readMethods, writeMethods } from '../../src/stores/eventStore.js'
import { getEventStore } from '../../src/stores/index.js'
import * as mongo from '../../src/stores/mongo/index.js'

const withEnv = (env, fn) => {
  const restore = mockedEnv(env)

  try {
    return fn()
  } finally {
    restore()
  }
}

const methodOf = (store, method) => store[method]

const assertImplementsInterface = (t, store) => {
  for (const method of methods) {
    t.is(typeof store[method], 'function', `'${method}' is missing`)
  }

  t.deepEqual(Object.keys(store).toSorted(), methods.toSorted())
}

test('lists every method once', (t) => {
  t.deepEqual([...new Set(methods)], methods)
  t.deepEqual(methods, [...writeMethods, ...readMethods])
})

test.serial('returns the mongo store for mongo', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'mongo' }, () => {
    const store = getEventStore()

    t.is(store, mongo)
    assertImplementsInterface(t, store)
  })
})

test.serial('returns the dual store for dual, which reads from mongo', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'dual', ACKEE_CLICKHOUSE_URL: 'http://localhost:8123' }, () => {
    const store = getEventStore()

    t.is(store, dual)
    assertImplementsInterface(t, store)

    for (const method of readMethods) {
      t.is(methodOf(store, method), methodOf(mongo, method), method)
    }
  })
})

test.serial('returns a store for clickhouse that writes like dual and reads from clickhouse', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'clickhouse', ACKEE_CLICKHOUSE_URL: 'http://localhost:8123' }, () => {
    const store = getEventStore()

    assertImplementsInterface(t, store)

    for (const method of writeMethods) {
      t.is(methodOf(store, method), methodOf(dual, method), method)
    }

    for (const method of readMethods) {
      t.is(methodOf(store, method), methodOf(clickhouse, method), method)
      t.not(methodOf(store, method), methodOf(mongo, method), method)
    }
  })
})

test.serial('reads the configured store on every call', (t) => {
  const first = withEnv({ ACKEE_EVENT_STORE: 'mongo' }, () => getEventStore())
  const second = withEnv({ ACKEE_EVENT_STORE: 'clickhouse', ACKEE_CLICKHOUSE_URL: 'http://localhost:8123' }, () =>
    getEventStore(),
  )

  t.is(first, mongo)
  t.not(second, mongo)
  t.is(second.views, clickhouse.views)
})
