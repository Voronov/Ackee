import test from 'ava'
import Redis from 'ioredis'
import mockedEnv from 'mocked-env'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import listen from 'test-listen'

import { close as closeClickHouse, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import Action from '../../src/models/Action.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import {
  close as closeQueue,
  createGroup,
  enqueue,
  group,
  length,
  ping,
  readBatch,
  stats,
} from '../../src/queue/redis.js'
import server from '../../src/server.js'
import { flush } from '../../src/stores/clickhouse/writer.js'
import { getEventStore } from '../../src/stores/index.js'
import { handle, maxDeliveries, processBatch, run, stop } from '../../src/worker.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from '../resolvers/_utils.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`
const stream = `ackee:events:test:${uuid()}`

const restore = mockedEnv({
  ACKEE_EVENT_STORE: 'dual',
  ACKEE_CLICKHOUSE_DATABASE: database,
  ACKEE_INGEST_QUEUE: 'redis',
  ACKEE_REDIS_STREAM: stream,
  ACKEE_METRICS: 'true',
})

const base = listen(server)

// A second connection, so that the stream can be inspected and dropped independently
// of the module under test
const inspector = new Redis(process.env.ACKEE_REDIS_URL)

const anonymizedFields = [
  'siteLanguage',
  'screenWidth',
  'screenHeight',
  'screenColorDepth',
  'deviceName',
  'deviceManufacturer',
  'osName',
  'osVersion',
  'browserName',
  'browserVersion',
  'browserWidth',
  'browserHeight',
]

const query = async (sql, parameters) => {
  const result = await getClient().query({
    query: sql,
    query_params: { database, ...parameters },
    format: 'JSONEachRow',
  })
  return result.json()
}

const countRows = async (table, column, value, final = true) => {
  const [row] = await query(
    `SELECT count() AS count FROM {database:Identifier}.{table:Identifier} ${final === true ? 'FINAL' : ''} WHERE {column:Identifier} = {value:String}`,
    { table, column, value },
  )
  return Number(row.count)
}

const countRecords = (domainId, final) => countRows('records', 'domainId', domainId, final)

const countActions = (eventId) => countRows('actions', 'eventId', eventId)

const recordIds = async (domainId) => {
  const rows = await query(`SELECT id FROM {database:Identifier}.records FINAL WHERE domainId = {domainId:String}`, {
    domainId,
  })
  return rows.map((row) => row.id)
}

const readRecord = async (id) => {
  const [row] = await query(
    `
      SELECT
        id,
        clientId,
        siteLocation,
        ${anonymizedFields.join(',\n        ')},
        toString(toUnixTimestamp64Milli(created)) AS created,
        toString(toUnixTimestamp64Milli(updated)) AS updated
      FROM {database:Identifier}.records FINAL
      WHERE id = {id:String}
    `,
    { id },
  )
  return row
}

const readAction = async (id) => {
  const [row] = await query(
    `
      SELECT id, key, value, details, toString(toUnixTimestamp64Milli(updated)) AS updated
      FROM {database:Identifier}.actions FINAL
      WHERE id = {id:String}
    `,
    { id },
  )
  return row
}

const pendingCount = async (key = stream) => {
  const [count] = await inspector.xpending(key, group)
  return count
}

const streamIds = async (key) => (await inspector.xrange(key, '-', '+')).map(([id]) => id)

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if ((await condition()) === true) return
    await sleep(10)
  }

  throw new Error('Condition not met in time')
}

const { MongoNetworkError } = mongoose.mongo

// The store as configured, except that one write fails as it does while MongoDB is away
const storeFailingOn = (failingId) => ({
  ...getEventStore(),
  addRecord: (data) => {
    if (data.id === failingId) return Promise.reject(new MongoNetworkError('connection lost'))
    return getEventStore().addRecord(data)
  },
})

const clientHeaders = (ip) => ({ 'X-Forwarded-For': ip, 'User-Agent': 'ackee-test' })

const visitorIp = (index) => `10.0.${Math.floor(index / 256)}.${index % 256}`

const createRecord = async (t, domainId, input, ip) => {
  const body = {
    query: gql`
      mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
        createRecord(domainId: $domainId, input: $input) {
          success
          payload {
            id
            created
            updated
          }
        }
      }
    `,
    variables: { domainId, input },
  }

  const { json } = await api(base, body, undefined, clientHeaders(ip))

  t.is(json.errors, undefined)
  t.true(json.data.createRecord.success)

  return json.data.createRecord.payload
}

const createRecords = async (t, domainId, count, concurrency = 50) => {
  const created = []

  for (let offset = 0; offset < count; offset += concurrency) {
    const entries = await Promise.all(
      Array.from({ length: Math.min(concurrency, count - offset) }, (_, index) =>
        createRecord(t, domainId, recordInput(offset + index), visitorIp(offset + index)),
      ),
    )
    created.push(...entries)
  }

  return created
}

const updateRecord = async (t, id) => {
  const body = {
    query: gql`
      mutation updateRecord($id: ID!) {
        updateRecord(id: $id) {
          success
        }
      }
    `,
    variables: { id },
  }

  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.errors, undefined)
  t.true(json.data.updateRecord.success)
}

const createAction = async (t, eventId, input) => {
  const body = {
    query: gql`
      mutation createAction($eventId: ID!, $input: CreateActionInput!) {
        createAction(eventId: $eventId, input: $input) {
          success
          payload {
            id
          }
        }
      }
    `,
    variables: { eventId, input },
  }

  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.errors, undefined)
  t.true(json.data.createAction.success)

  return json.data.createAction.payload
}

const updateAction = async (t, id, input) => {
  const body = {
    query: gql`
      mutation updateAction($id: ID!, $input: UpdateActionInput!) {
        updateAction(id: $id, input: $input) {
          success
        }
      }
    `,
    variables: { id, input },
  }

  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.errors, undefined)
  t.true(json.data.updateAction.success)
}

const recordInput = (index) => ({
  siteLocation: `https://example.com/page-${index}`,
  siteReferrer: index % 2 === 0 ? 'https://google.com/' : undefined,
  siteLanguage: 'en',
  screenWidth: 1920,
  screenHeight: 1080,
  screenColorDepth: 24,
  deviceName: 'iPhone',
  deviceManufacturer: 'Apple',
  osName: 'iOS',
  osVersion: '17.0',
  browserName: index % 3 === 0 ? 'Safari' : 'Firefox',
  browserVersion: '18.0',
  browserWidth: 1400,
  browserHeight: 900,
})

// Short blocks and no idle threshold: the tests own the whole stream, so anything
// pending is a crashed consumer by definition
const drain = () => run({ until: 'empty', minIdle: 0, block: 10 })

test.before(async () => {
  await connectToDatabase()
  await ensureSchema(database)
  await ping()
})

test.after.always(async () => {
  await getClient().command({ query: 'DROP DATABASE IF EXISTS {database:Identifier}', query_params: { database } })
  await closeClickHouse()
  await closeQueue()
  await inspector.del(stream)
  await inspector.quit()
  await cleanup(server)()
  restore()
})

test.beforeEach(async (t) => {
  t.context.token = await Token.create({})
  t.context.domain = await Domain.create({ title: 'Example' })
  t.context.event = await Event.create({ title: 'Example', type: 'TOTAL_CHART' })
})

test.serial('answers 5000 createRecord before anything is stored and the worker writes exactly those', async (t) => {
  const domainId = t.context.domain.id
  const processedBefore = stats.processed

  const created = await createRecords(t, domainId, 5000)

  t.is(created.length, 5000)
  t.is(new Set(created.map((entry) => entry.id)).size, 5000)
  t.is(await Record.countDocuments({ domainId }), 0)
  t.is(await countRecords(domainId), 0)
  t.is(await inspector.xlen(stream), 5000)

  await drain()

  t.is(await Record.countDocuments({ domainId }), 5000)
  t.is(await countRecords(domainId), 5000)
  t.is(await pendingCount(), 0)
  t.is(stats.processed - processedBefore, 5000)

  const expectedIds = created.map((entry) => entry.id).toSorted()
  const mongoIds = (await Record.find({ domainId }).select('id').lean()).map((record) => record.id).toSorted()

  t.deepEqual(mongoIds, expectedIds)
  t.deepEqual((await recordIds(domainId)).toSorted(), expectedIds)

  // The dates the tracker was told are the dates that got stored
  const sample = created[1234]
  const mongoRecord = await Record.findOne({ id: sample.id }).lean()
  const clickhouseRecord = await readRecord(sample.id)

  t.is(mongoRecord.created.toISOString(), sample.created)
  t.is(mongoRecord.updated.toISOString(), sample.updated)
  t.is(mongoRecord.siteLocation, 'https://example.com/page-1234')
  t.is(mongoRecord.browserName, 'Firefox')
  t.is(clickhouseRecord.created, String(mongoRecord.created.getTime()))
  t.is(clickhouseRecord.clientId, mongoRecord.clientId)
  t.is(clickhouseRecord.browserName, 'Firefox')
})

const assertStoredOnce = async (t, domainId, created) => {
  const expectedIds = created.map((entry) => entry.id).toSorted()
  const mongoIds = (await Record.find({ domainId }).select('id').lean()).map((record) => record.id).toSorted()

  t.is(await pendingCount(), 0)
  t.is(await Record.countDocuments({ domainId }), created.length)
  t.is(await countRecords(domainId), created.length)
  t.deepEqual(mongoIds, expectedIds)
  t.deepEqual((await recordIds(domainId)).toSorted(), expectedIds)
}

test.serial(
  'redelivers a batch a worker wrote and flushed but never acknowledged, storing every record once',
  async (t) => {
    const domainId = t.context.domain.id

    const created = await createRecords(t, domainId, 2000)

    const batch = await readBatch('crashed', { count: 1000, block: 10 })
    t.is(batch.length, 1000)

    for (const message of batch) await handle(message)

    await flush()
    t.is(await Record.countDocuments({ domainId }), 1000)
    t.is(await countRecords(domainId), 1000)
    t.is(await pendingCount(), 1000)

    const failedBefore = stats.failed
    await drain()

    t.is(stats.failed, failedBefore)
    await assertStoredOnce(t, domainId, created)
  },
)

test.serial('repairs ClickHouse when the crashed worker had written MongoDB but not flushed', async (t) => {
  const domainId = t.context.domain.id

  const created = await createRecords(t, domainId, 1500)

  // Delivered and written to MongoDB as the worker would have, the buffered ClickHouse
  // rows died with the process
  const batch = await readBatch('crashed', { count: 1000, block: 10 })
  await Record.insertMany(batch.map((message) => JSON.parse(message.payload)))

  t.is(await Record.countDocuments({ domainId }), 1000)
  t.is(await countRecords(domainId), 0)
  t.is(await pendingCount(), 1000)

  const failedBefore = stats.failed
  await drain()

  t.is(stats.failed, failedBefore)
  await assertStoredOnce(t, domainId, created)

  const { id } = JSON.parse(batch[7].payload)
  const mongoRecord = await Record.findOne({ id }).lean()
  const clickhouseRecord = await readRecord(id)

  t.is(clickhouseRecord.clientId, mongoRecord.clientId)
  t.is(clickhouseRecord.siteLocation, mongoRecord.siteLocation)
  t.is(clickhouseRecord.created, String(mongoRecord.created.getTime()))
})

test.serial('processes one batch with once and leaves the rest in the stream', async (t) => {
  const domainId = t.context.domain.id

  await createRecords(t, domainId, 250)
  await run({ once: true, count: 100, minIdle: 0, block: 10 })

  t.is(await Record.countDocuments({ domainId }), 100)
  t.is(await pendingCount(), 0)

  await drain()

  t.is(await Record.countDocuments({ domainId }), 250)
  t.is(await countRecords(domainId), 250)
})

test.serial('updateRecord through the queue bumps updated in MongoDB and adds a version in ClickHouse', async (t) => {
  const domainId = t.context.domain.id
  const before = Date.now()

  const { id } = await createRecord(t, domainId, recordInput(0), visitorIp(0))
  await updateRecord(t, id)
  const after = Date.now()

  await drain()

  const mongoRecord = await Record.findOne({ id }).lean()
  const clickhouseRecord = await readRecord(id)

  t.true(mongoRecord.updated.getTime() >= mongoRecord.created.getTime())
  t.true(mongoRecord.updated.getTime() >= before)
  t.true(mongoRecord.updated.getTime() <= after)
  t.is(clickhouseRecord.updated, String(mongoRecord.updated.getTime()))
  t.is(clickhouseRecord.browserName, 'Safari')
  t.is(await countRecords(domainId), 1)
})

test.serial('anonymizes the earlier record of a visitor through the queue in both stores', async (t) => {
  const domainId = t.context.domain.id
  const ip = '10.2.2.2'

  const first = await createRecord(t, domainId, recordInput(0), ip)
  const second = await createRecord(t, domainId, recordInput(3), ip)

  await drain()

  const mongoFirst = await Record.findOne({ id: first.id }).lean()
  const mongoSecond = await Record.findOne({ id: second.id }).lean()
  const clickhouseFirst = await readRecord(first.id)
  const clickhouseSecond = await readRecord(second.id)

  t.is(mongoFirst.clientId, null)
  t.is(clickhouseFirst.clientId, '')
  t.is(clickhouseFirst.siteLocation, mongoFirst.siteLocation)

  for (const field of anonymizedFields) {
    t.is(mongoFirst[field], null, field)
    t.is(clickhouseFirst[field], null, field)
  }

  t.is(typeof mongoSecond.clientId, 'string')
  t.is(clickhouseSecond.clientId, mongoSecond.clientId)

  for (const field of anonymizedFields) {
    t.not(mongoSecond[field], null, field)
    t.is(clickhouseSecond[field], mongoSecond[field], field)
  }

  t.is(await countRecords(domainId), 2)
})

test.serial('creates and touches actions through the queue', async (t) => {
  const eventId = t.context.event.id

  const { id } = await createAction(t, eventId, { key: 'Click', value: 1 })
  await updateAction(t, id, { key: 'Click', value: 3, details: 'Header' })

  t.is(await Action.countDocuments({ eventId }), 0)

  await drain()

  const mongoAction = await Action.findOne({ id }).lean()
  const clickhouseAction = await readAction(id)

  t.is(mongoAction.key, 'Click')
  t.is(mongoAction.value, 3)
  t.is(mongoAction.details, 'Header')
  t.true(mongoAction.updated.getTime() >= mongoAction.created.getTime())
  t.deepEqual(clickhouseAction, {
    id,
    key: 'Click',
    value: 3,
    details: 'Header',
    updated: String(mongoAction.updated.getTime()),
  })
  t.is(await countActions(eventId), 1)
})

test.serial('repairs ClickHouse for an action the crashed worker had written to MongoDB only', async (t) => {
  const eventId = t.context.event.id

  const { id } = await createAction(t, eventId, { key: 'Signup', value: 2 })

  const [message] = await readBatch('crashed', { count: 10, block: 10 })
  await Action.insertMany([JSON.parse(message.payload)])

  t.is(await Action.countDocuments({ eventId }), 1)
  t.is(await countActions(eventId), 0)

  await drain()

  const mongoAction = await Action.findOne({ id }).lean()

  t.is(await pendingCount(), 0)
  t.is(await Action.countDocuments({ eventId }), 1)
  t.deepEqual(await readAction(id), {
    id,
    key: 'Signup',
    value: 2,
    details: null,
    updated: String(mongoAction.updated.getTime()),
  })
})

test.serial('rejects invalid input before enqueueing, with the same message as without the queue', async (t) => {
  const body = {
    query: gql`
      mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
        createRecord(domainId: $domainId, input: $input) {
          success
          payload {
            id
          }
        }
      }
    `,
    variables: { domainId: t.context.domain.id, input: { siteLocation: 'https://example.com/', siteLanguage: 'eng' } },
  }

  const lengthBefore = await inspector.xlen(stream)
  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.data, null)
  t.is(json.errors[0].message, 'Path `siteLanguage` (`eng`, length 3) is longer than the maximum allowed length (2)')
  t.is(await inspector.xlen(stream), lengthBefore)
})

test.serial(
  'drops broken messages at once, a touch for an unknown id after five deliveries, and keeps going',
  async (t) => {
    const domainId = t.context.domain.id
    const droppedBefore = stats.dropped
    const failedBefore = stats.failed

    await inspector.xadd(stream, '*', 'type', 'record.create', 'payload', '{not json')
    await inspector.xadd(stream, '*', 'type', 'record.create', 'payload', 'null')
    await enqueue('record.create', { id: uuid(), clientId: 'client', domainId, siteLocation: 'not a url' })
    await enqueue('record.touch', { id: 'missing-record', updated: Date.now() })
    await enqueue('action.touch', { id: 'missing-action', key: 'Click', value: 1 })
    await enqueue('nothing.known', { id: uuid() })
    const { id } = await createRecord(t, domainId, recordInput(0), visitorIp(0))

    await drain()

    t.is(await pendingCount(), 0)
    t.is(stats.dropped - droppedBefore, 6)
    t.is(stats.failed - failedBefore, 4 + 2 * maxDeliveries)
    t.is(await Record.countDocuments({ domainId }), 1)
    t.is(await Record.countDocuments({ id }), 1)
    t.is(await countRecords(domainId), 1)
  },
)

test.serial('acknowledges the prefix before a store outage and leaves the rest pending, retried later', async (t) => {
  const domainId = t.context.domain.id
  const droppedBefore = stats.dropped
  const failedBefore = stats.failed

  const created = await createRecords(t, domainId, 3)
  const messages = await readBatch('outage', { count: 10, block: 10 })
  const store = storeFailingOn(created[1].id)

  const error = await t.throwsAsync(() => handle(messages[1], store))
  t.is(error.name, 'MongoNetworkError')

  const outage = await processBatch(messages, store)

  t.is(outage.name, 'MongoNetworkError')
  t.is(outage.message, 'connection lost')
  t.is(await Record.countDocuments({ domainId }), 1)
  t.is(await Record.countDocuments({ id: created[0].id }), 1)
  t.is(await countRecords(domainId), 1)
  t.is(await pendingCount(), 2)
  t.is(stats.dropped, droppedBefore)
  t.is(stats.failed - failedBefore, 1)

  await drain()

  t.is(stats.dropped, droppedBefore)
  await assertStoredOnce(t, domainId, created)
})

test.serial('stop finishes and acknowledges the current batch, then run returns', async (t) => {
  const domainId = t.context.domain.id

  await createRecords(t, domainId, 250)

  const running = run({ count: 100, minIdle: 0, block: 10 })
  await waitFor(async () => (await Record.countDocuments({ domainId })) >= 100)
  stop()
  await running

  const written = await Record.countDocuments({ domainId })

  t.true(written === 100 || written === 200, `${written} written`)
  t.is(await countRecords(domainId), written)
  t.is(await pendingCount(), 0)
  t.is(await length(), 250 - written)

  await drain()

  t.is(await Record.countDocuments({ domainId }), 250)
  t.is(await countRecords(domainId), 250)
})

test.serial('trims acknowledged entries older than a day after a batch, never unacknowledged ones', async (t) => {
  const domainId = t.context.domain.id
  const trimStream = `${stream}:trim`
  const restoreStream = mockedEnv({ ACKEE_REDIS_STREAM: trimStream })
  const dayAgo = Date.now() - 25 * 60 * 60 * 1000

  const oldPayload = (index) => ({
    ...recordInput(index),
    id: uuid(),
    clientId: `client-${index}`,
    domainId,
    created: dayAgo + index,
    updated: dayAgo + index,
  })

  try {
    const first = oldPayload(0)
    const second = oldPayload(1)
    await inspector.xadd(trimStream, `${dayAgo}-0`, 'type', 'record.create', 'payload', JSON.stringify(first))
    await inspector.xadd(trimStream, `${dayAgo + 1}-0`, 'type', 'record.create', 'payload', JSON.stringify(second))
    const recent = await createRecord(t, domainId, recordInput(2), visitorIp(2))
    const [recentId] = (await streamIds(trimStream)).slice(-1)

    t.is(await inspector.xlen(trimStream), 3)

    // The first entry is in flight on another consumer: it and everything after it
    // stay, however old, until it is acknowledged
    await createGroup()
    const [inFlight] = await readBatch('crashed', { count: 1, block: 10 })
    t.is(inFlight.id, `${dayAgo}-0`)

    await run({ until: 'empty', minIdle: 60_000, block: 10 })

    t.is(await Record.countDocuments({ domainId }), 2)
    t.is(await Record.countDocuments({ id: first.id }), 0)
    t.is(await pendingCount(trimStream), 1)
    t.deepEqual(await streamIds(trimStream), [`${dayAgo}-0`, `${dayAgo + 1}-0`, recentId])

    await drain()

    t.is(await Record.countDocuments({ domainId }), 3)
    t.is(await Record.countDocuments({ id: first.id }), 1)
    t.is(await Record.countDocuments({ id: second.id }), 1)
    t.is(await Record.countDocuments({ id: recent.id }), 1)
    t.is(await pendingCount(trimStream), 0)
    t.deepEqual(await streamIds(trimStream), [recentId])
  } finally {
    restoreStream()
    await inspector.del(trimStream)
  }
})

test.serial('exposes the queue counters and the stream length on /metrics', async (t) => {
  const domainId = t.context.domain.id

  await createRecords(t, domainId, 3)

  const response = await fetch(new URL('/metrics', await base))
  const output = await response.text()

  t.is(response.status, 200)
  t.true(output.includes('# TYPE ackee_queue_length gauge\n'))
  t.true(output.includes('ackee_queue_length 3\n'))
  t.true(output.includes(`ackee_queue_processed_total ${stats.processed}\n`))
  t.true(output.includes(`ackee_queue_failed_total ${stats.failed}\n`))
  t.true(output.includes(`ackee_queue_dropped_total ${stats.dropped}\n`))

  await drain()
})
