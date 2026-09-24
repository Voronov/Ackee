import test from 'ava'
import mockedEnv from 'mocked-env'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

import { job as saltJob } from '../src/utils/salt.js'

const mongoDb = MongoMemoryServer.create()

// A module is evaluated once per specifier, and a module that threw stays rejected, so
// each case needs a specifier of its own to be evaluated with its own environment.
const load = async (label, env) => {
  const dbUrl = (await mongoDb).getUri()
  const restore = mockedEnv({ ACKEE_MONGODB: dbUrl, ...env })

  try {
    return await import(`../src/serverless.js?case=${label}`)
  } finally {
    restore()
  }
}

test.after.always(async () => {
  saltJob.cancel()
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

test.serial('refuses to start with the clickhouse event store', async (t) => {
  const error = await t.throwsAsync(
    load('clickhouse', { ACKEE_EVENT_STORE: 'clickhouse', ACKEE_CLICKHOUSE: 'http://localhost:8123' }),
  )

  t.true(error.message.includes('ACKEE_EVENT_STORE=mongo'))
  t.true(error.message.includes('ACKEE_INGEST_QUEUE=none'))
  t.true(error.message.includes("got 'clickhouse' and 'none'"))
})

test.serial('refuses to start with the dual event store', async (t) => {
  const error = await t.throwsAsync(
    load('dual', { ACKEE_EVENT_STORE: 'dual', ACKEE_CLICKHOUSE: 'http://localhost:8123' }),
  )

  t.true(error.message.includes("got 'dual' and 'none'"))
})

test.serial('refuses to start with the redis ingest queue', async (t) => {
  const error = await t.throwsAsync(
    load('queue', { ACKEE_INGEST_QUEUE: 'redis', ACKEE_REDIS_URL: 'redis://localhost:6379' }),
  )

  t.true(error.message.includes("got 'mongo' and 'redis'"))
})

test.serial('reports an unknown event store instead of the serverless limitation', async (t) => {
  await t.throwsAsync(load('unknown', { ACKEE_EVENT_STORE: 'postgres' }), {
    message: "Unknown ACKEE_EVENT_STORE 'postgres', expected one of: mongo, dual, clickhouse",
  })
})

test.serial('starts with the mongo event store and no queue', async (t) => {
  const { handler } = await load('mongo', { ACKEE_EVENT_STORE: 'mongo', ACKEE_INGEST_QUEUE: 'none' })

  t.is(typeof handler, 'function')
})
