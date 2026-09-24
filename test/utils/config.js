import test from 'ava'
import mockedEnv from 'mocked-env'

import config, {
  usesClickHouse,
  usesQueue,
  validateEventStoreConfig,
  validateIngestQueueConfig,
} from '../../src/utils/config.js'

const withEnv = (env, fn) => {
  const restore = mockedEnv(env)

  try {
    fn()
  } finally {
    restore()
  }
}

test('defaults the event store to mongo', (t) => {
  withEnv({ ACKEE_EVENT_STORE: undefined }, () => {
    t.is(config.eventStore, 'mongo')
    t.false(usesClickHouse())
    t.notThrows(validateEventStoreConfig)
  })
})

test('defaults the clickhouse database to ackee', (t) => {
  withEnv({ ACKEE_CLICKHOUSE_DATABASE: undefined }, () => {
    t.is(config.clickhouseDatabase, 'ackee')
  })
})

test('reads the clickhouse url and database from the environment', (t) => {
  withEnv(
    {
      ACKEE_EVENT_STORE: 'clickhouse',
      ACKEE_CLICKHOUSE: 'http://clickhouse:8123',
      ACKEE_CLICKHOUSE_DATABASE: 'analytics',
    },
    () => {
      t.is(config.eventStore, 'clickhouse')
      t.is(config.clickhouseUrl, 'http://clickhouse:8123')
      t.is(config.clickhouseDatabase, 'analytics')
      t.true(usesClickHouse())
      t.notThrows(validateEventStoreConfig)
    },
  )
})

test('does not require a clickhouse url for the mongo store', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'mongo', ACKEE_CLICKHOUSE: undefined }, () => {
    t.notThrows(validateEventStoreConfig)
  })
})

test('throws for an unknown event store', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'postgres' }, () => {
    t.throws(validateEventStoreConfig, {
      message: "Unknown ACKEE_EVENT_STORE 'postgres', expected one of: mongo, dual, clickhouse",
    })
  })
})

test('throws for the dual store without a clickhouse url', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'dual', ACKEE_CLICKHOUSE: undefined }, () => {
    t.throws(validateEventStoreConfig, {
      message: "ACKEE_CLICKHOUSE is required when ACKEE_EVENT_STORE is 'dual'",
    })
  })
})

test('throws for the clickhouse store without a clickhouse url', (t) => {
  withEnv({ ACKEE_EVENT_STORE: 'clickhouse', ACKEE_CLICKHOUSE: undefined }, () => {
    t.throws(validateEventStoreConfig, {
      message: "ACKEE_CLICKHOUSE is required when ACKEE_EVENT_STORE is 'clickhouse'",
    })
  })
})

test('defaults the ingest queue to none and needs no redis url for it', (t) => {
  withEnv({ ACKEE_INGEST_QUEUE: undefined, ACKEE_REDIS_URL: undefined }, () => {
    t.is(config.ingestQueue, 'none')
    t.false(usesQueue())
    t.notThrows(validateIngestQueueConfig)
  })
})

test('defaults the redis stream to ackee:events', (t) => {
  withEnv({ ACKEE_REDIS_STREAM: undefined }, () => {
    t.is(config.redisStream, 'ackee:events')
  })
})

test('reads the redis url and stream from the environment', (t) => {
  withEnv(
    { ACKEE_INGEST_QUEUE: 'redis', ACKEE_REDIS_URL: 'redis://redis:6379', ACKEE_REDIS_STREAM: 'ackee:test' },
    () => {
      t.is(config.ingestQueue, 'redis')
      t.is(config.redisUrl, 'redis://redis:6379')
      t.is(config.redisStream, 'ackee:test')
      t.true(usesQueue())
      t.notThrows(validateIngestQueueConfig)
    },
  )
})

test('throws for an unknown ingest queue', (t) => {
  withEnv({ ACKEE_INGEST_QUEUE: 'kafka' }, () => {
    t.throws(validateIngestQueueConfig, {
      message: "Unknown ACKEE_INGEST_QUEUE 'kafka', expected one of: none, redis",
    })
  })
})

test('throws for the redis queue without a redis url', (t) => {
  withEnv({ ACKEE_INGEST_QUEUE: 'redis', ACKEE_REDIS_URL: undefined }, () => {
    t.throws(validateIngestQueueConfig, {
      message: "ACKEE_REDIS_URL is required when ACKEE_INGEST_QUEUE is 'redis'",
    })
  })
})
