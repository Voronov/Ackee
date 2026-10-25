import { createClient } from '@redis/client'
import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import listen from 'test-listen'

import { INGEST_STREAM } from '../../src/constants/ingest.js'
import { getUnscoped } from '../../src/database/domains.js'
import * as records from '../../src/database/records.js'
import { sealedUntil } from '../../src/database/rollups.js'
import Record from '../../src/models/Record.js'
import RollupState from '../../src/models/RollupState.js'
import { recordTouch } from '../../src/queue/messages.js'
import { adapter, close, oldest, start, stats } from '../../src/queue/redis.js'
import { drain } from '../../src/queue/worker.js'
import server from '../../src/server.js'
import { run as runRollups } from '../../src/utils/rollupJob.js'
import { day, minute } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { openStream } from '../live/_stream.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

// Refused at once, nothing listens on it
const UNREACHABLE = 'redis://127.0.0.1:1'

// Needs a Redis without data worth keeping: ACKEE_TEST_REDIS=redis://127.0.0.1:6379 npx ava test/resolvers/ingestQueue.js
// A database of its own, so the files that share the Redis do not see each other's stream.
const testRedis = () => {
  const url = new URL(process.env.ACKEE_TEST_REDIS)
  url.pathname = '/15'
  return url.href
}

const withRedis = process.env.ACKEE_TEST_REDIS == null ? test.skip : test.serial

const input = {
  siteLocation: 'https://example.com/page',
  siteReferrer: 'https://google.com/',
  source: 'Newsletter',
  siteLanguage: 'en',
  screenWidth: 1920,
  screenHeight: 1080,
  screenColorDepth: 24,
  deviceName: 'iPhone',
  deviceManufacturer: 'Apple',
  osName: 'iOS',
  osVersion: '18.0',
  browserName: 'Safari',
  browserVersion: '18.0',
  browserWidth: 1200,
  browserHeight: 800,
}

const createRecord = (domainId, variables = {}, headers = {}) =>
  api(
    base,
    {
      query: gql`
        mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
          createRecord(domainId: $domainId, input: $input) {
            success
            payload {
              id
              siteLocation
              browserName
            }
          }
        }
      `,
      variables: { domainId, input: { ...input, ...variables } },
    },
    undefined,
    // Each test is a visitor of its own, so the anonymization of one does not reach another
    { 'User-Agent': `test-${uuid()}`, ...headers },
  )

const updateRecord = (id) =>
  api(base, {
    query: gql`
      mutation updateRecord($id: ID!) {
        updateRecord(id: $id) {
          success
        }
      }
    `,
    variables: { id },
  })

// What a record keeps of the visit, without what differs between any two records
const visitOf = (entry) =>
  Object.fromEntries(
    Object.entries(entry).filter(
      ([key]) => ['_id', '__v', 'id', 'clientId', 'created', 'updated'].includes(key) === false,
    ),
  )

let restore

const useQueue = (url) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: url })
}

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)
test.afterEach.always(async () => {
  restore?.()
  restore = undefined
  await close()
})

const inspect = async (t) => {
  const inspector = createClient({ url: testRedis() })
  await inspector.connect()
  await inspector.flushDb()
  t.teardown(() => inspector.destroy())

  useQueue(testRedis())

  return inspector
}

test.serial('without the queue a view is written before the tracker is answered', async (t) => {
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: '' })
  const before = { ...stats.fallback }

  const { json } = await createRecord(t.context.domain.id)
  const { id } = json.data.createRecord.payload

  t.is(await Record.countDocuments({ id }), 1)
  t.deepEqual(stats.fallback, before)

  // The tracker still learns about a record that does not exist
  const { json: unknown } = await updateRecord(uuid())
  t.is(unknown.errors[0].message, 'Unknown record')
})

test.serial('an unreachable queue writes the view directly, with the id the tracker got', async (t) => {
  useQueue(UNREACHABLE)
  const before = stats.fallback.unavailable ?? 0

  const first = await createRecord(t.context.domain.id, {}, { 'User-Agent': 'visitor' })
  const second = await createRecord(t.context.domain.id, {}, { 'User-Agent': 'visitor' })
  const earlier = await Record.findOne({ id: first.json.data.createRecord.payload.id }).lean()
  const latest = await Record.findOne({ id: second.json.data.createRecord.payload.id }).lean()

  t.is(stats.fallback.unavailable, before + 2)
  t.is(earlier.clientId, null)
  t.is(earlier.browserName, null)
  t.is(typeof latest.clientId, 'string')
  t.is(latest.browserName, 'Safari')

  // A touch moves updated at once, and one for an unknown id is no error: with the queue its
  // create might still be waiting there
  await sleep(5)
  t.true((await updateRecord(latest.id)).json.data.updateRecord.success)
  t.true((await Record.findOne({ id: latest.id }).lean()).updated > latest.updated)
  t.true((await updateRecord(uuid())).json.data.updateRecord.success)
})

// Waiting a second for Redis, the API may find a newer view of the visitor the worker already stored
test.serial('a view written directly leaves the visitor with a newer view the worker stored', async (t) => {
  useQueue(UNREACHABLE)
  const { domain } = t.context
  const headers = { 'User-Agent': 'visitor' }

  const first = (await createRecord(domain.id, {}, headers)).json.data.createRecord.payload
  const { clientId } = await Record.findOne({ id: first.id }).lean()

  const newer = uuid()
  const created = new Date(Date.now() + minute)
  await records.addOnce({ ...input, id: newer, clientId, domainId: domain.id, created, updated: created })

  const late = (await createRecord(domain.id, {}, headers)).json.data.createRecord.payload
  const kept = await Record.find({ clientId }).lean()
  const forgotten = await Record.findOne({ id: late.id }).lean()

  t.deepEqual(
    kept.map((entry) => entry.id),
    [newer],
  )
  t.is(kept[0].browserName, 'Safari')
  t.is(forgotten.browserName, null)
  t.is(forgotten.siteLocation, input.siteLocation)
})

test.serial('rollups are skipped while the queue is unreachable', async (t) => {
  useQueue(UNREACHABLE)

  await runRollups()

  t.is(await RollupState.countDocuments(), 0)
})

withRedis('the tracker gets the id before the view is written, and the worker stores it under it', async (t) => {
  const inspector = await inspect(t)
  const before = Date.now()

  const { json } = await createRecord(t.context.domain.id)
  const { success, payload } = json.data.createRecord

  t.true(success)
  t.is(payload.siteLocation, input.siteLocation)
  t.is(payload.browserName, input.browserName)
  t.is(await Record.countDocuments({ id: payload.id }), 0)
  t.is(await inspector.xLen(INGEST_STREAM), 1)

  // Neither the IP nor the user agent reaches Redis, only the clientId made from them
  const [entry] = await inspector.xRange(INGEST_STREAM, '-', '+')
  t.false(entry.message.data.includes('127.0.0.1'))
  t.false(entry.message.data.includes('test-'))

  await drain(adapter())

  const stored = await Record.findOne({ id: payload.id }).lean()
  t.true(stored.created.getTime() >= before)
  t.true(stored.created.getTime() <= Date.now())
  t.is(await inspector.xLen(INGEST_STREAM), 0)
})

withRedis('a view through the queue is stored as the direct path stores it', async (t) => {
  await inspect(t)

  const queued = (await createRecord(t.context.domain.id)).json.data.createRecord.payload
  await drain(adapter())

  restore()
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: '' })
  const direct = (await createRecord(t.context.domain.id)).json.data.createRecord.payload

  const viaQueue = await Record.findOne({ id: queued.id }).lean()
  const viaApi = await Record.findOne({ id: direct.id }).lean()

  t.is(typeof viaQueue.clientId, 'string')
  t.deepEqual(visitOf(viaQueue), visitOf(viaApi))
  // The tracker gets the same answer either way
  t.deepEqual({ ...queued, id: undefined }, { ...direct, id: undefined })
})

withRedis('the tracker sees the same errors with the queue', async (t) => {
  const inspector = await inspect(t)

  const attempts = () =>
    Promise.all([
      createRecord(uuid()),
      createRecord(t.context.domain.id, { siteLanguage: 'english' }),
      createRecord(t.context.domain.id, { screenColorDepth: 100 }),
    ])
  const messagesOf = (results) => results.map(({ json }) => json.errors[0].message)

  const queued = messagesOf(await attempts())

  restore()
  restore = mockedEnv({ ACKEE_INGEST_QUEUE: '' })
  const direct = messagesOf(await attempts())

  t.is(queued[0], 'Unknown domain')
  t.regex(queued[1], /siteLanguage/)
  t.deepEqual(queued, direct)
  t.is(await inspector.xLen(INGEST_STREAM), 0)
})

withRedis('a touch through the queue moves updated once the worker wrote it', async (t) => {
  const inspector = await inspect(t)

  const { id } = (await createRecord(t.context.domain.id)).json.data.createRecord.payload
  await drain(adapter())
  const created = (await Record.findOne({ id }).lean()).updated

  await sleep(5)
  t.true((await updateRecord(id)).json.data.updateRecord.success)
  t.is(await inspector.xLen(INGEST_STREAM), 1)
  t.deepEqual((await Record.findOne({ id }).lean()).updated, created)

  await drain(adapter())
  t.true((await Record.findOne({ id }).lean()).updated > created)
})

withRedis('a redelivered view is stored once', async (t) => {
  const inspector = await inspect(t)

  const { id } = (await createRecord(t.context.domain.id)).json.data.createRecord.payload
  const [entry] = await inspector.xRange(INGEST_STREAM, '-', '+')

  await drain(adapter())
  // The same message once more, as if the first delivery had died before its ack
  await inspector.xAdd(INGEST_STREAM, '*', entry.message)
  await drain(adapter())

  t.is(await Record.countDocuments({ id }), 1)
  t.is(await inspector.xLen(INGEST_STREAM), 0)
})

withRedis('the worker of the server writes what the tracker sent', async (t) => {
  await inspect(t)

  const worker = start({ block: 50 })
  t.teardown(worker.stop)

  const { id } = (await createRecord(t.context.domain.id)).json.data.createRecord.payload

  for (let attempt = 0; attempt < 100 && (await Record.countDocuments({ id })) === 0; attempt++) await sleep(20)
  await worker.stop()

  t.is(await Record.countDocuments({ id }), 1)
})

withRedis('rollups stop at the oldest event still in the queue', async (t) => {
  const inspector = await inspect(t)
  const since = new Date(Date.now() - 3 * day)

  // An event from three days ago that the worker has not written yet
  await inspector.xAdd(INGEST_STREAM, '*', recordTouch(uuid(), since))
  await createRecord(t.context.domain.id)
  t.deepEqual(await oldest(), since)

  await runRollups()

  const state = await RollupState.findOne({ _id: 'records' }).lean()
  t.deepEqual(state.until, sealedUntil(new Date(), since))
  t.true(state.until < sealedUntil(new Date()))
})

// The live feed reads MongoDB, so a queued view shows up once the worker wrote it (ADR-007)
withRedis('a view through the queue reaches the live stream once the worker wrote it', async (t) => {
  await inspect(t)

  const stream = await openStream(base, { token: t.context.token.id, domainId: t.context.domain.id })
  t.teardown(stream.close)

  const { id } = (await createRecord(t.context.domain.id)).json.data.createRecord.payload

  // Still in the queue: a tick of the feed comes and goes without it
  await sleep(2500)
  t.deepEqual(stream.visits(), [])

  const started = Date.now()
  await drain(adapter())
  const entry = await stream.waitFor((item) => item.event === 'visit')

  t.is(await Record.countDocuments({ id }), 1)
  t.is(entry.data.siteLocation, input.siteLocation)
  t.true(Date.now() - started <= 10_000)
})

const manage = (t, query, variables) => api(base, { query, variables }, t.context.token.id)

// The domain cache of the queue must not delay what the owner changes for safety
test.serial('with the queue a rotated key, strict mode and a deleted domain apply at once', async (t) => {
  useQueue(UNREACHABLE)
  const { id } = t.context.domain
  const origin = { Origin: 'https://example.com' }

  // Read into the cache before anything changes
  t.true((await createRecord(id)).json.data.createRecord.success)

  await manage(
    t,
    gql`
      mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
        updateDomain(id: $id, input: $input) {
          success
        }
      }
    `,
    { id, input: { title: 'example.com', strictIngest: true } },
  )

  t.regex((await createRecord(id, {}, origin)).json.errors[0].message, /key missing or wrong/i)

  const { ingestKey: oldKey } = await getUnscoped(id)
  t.true((await createRecord(id, {}, { ...origin, 'X-Ackee-Key': oldKey })).json.data.createRecord.success)

  const { json } = await manage(
    t,
    gql`
      mutation rotateIngestKey($id: ID!) {
        rotateIngestKey(id: $id) {
          payload {
            ingestKey
          }
        }
      }
    `,
    { id },
  )
  const newKey = json.data.rotateIngestKey.payload.ingestKey

  const refused = await createRecord(id, {}, { ...origin, 'X-Ackee-Key': oldKey })
  t.regex(refused.json.errors[0].message, /key missing or wrong/i)
  t.true((await createRecord(`${id}.${newKey}`, {}, origin)).json.data.createRecord.success)

  await manage(
    t,
    gql`
      mutation deleteDomain($id: ID!) {
        deleteDomain(id: $id) {
          success
        }
      }
    `,
    { id },
  )

  t.is((await createRecord(`${id}.${newKey}`, {}, origin)).json.errors[0].message, 'Unknown domain')
})
