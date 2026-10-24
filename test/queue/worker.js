import test from 'ava'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { INGEST_MAX_DELIVERIES, INGEST_VERSION, RECORD_CREATE, RECORD_TOUCH } from '../../src/constants/ingest.js'
import * as records from '../../src/database/records.js'
import { decode, PoisonError, recordCreate, recordTouch } from '../../src/queue/messages.js'
import { drain, processBatch, start, stats } from '../../src/queue/worker.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import connect from '../../src/utils/connect.js'
import signale from '../../src/utils/signale.js'
import { minute } from '../../src/utils/times.js'

const mongoDb = MongoMemoryServer.create()

const { MongoNetworkError } = mongoose.mongo

const sequenceOf = (id) => Number(id.split('-')[0])

// Behaves like a Redis stream with one consumer group, for the commands the worker uses.
// Acknowledged entries are deleted, as XACK + XDEL do.
const createQueue = () => {
  const entries = []
  const failures = new Map()
  // When each consumer was last handed something
  const consumers = new Map()
  let sequence = 0

  // Rejects once with the error set by failNext, as a command does while Redis is away
  const failing = (method) => {
    const error = failures.get(method)
    failures.delete(method)
    return error == null ? Promise.resolve() : Promise.reject(error)
  }

  const handOut = (entry, consumer) => {
    consumers.set(consumer, Date.now())
    entry.delivered = true
    entry.deliveries++
    entry.consumer = consumer
    entry.since = Date.now()
    return { id: entry.id, fields: entry.fields }
  }

  return {
    entries,
    consumers,
    groups: 0,
    add(fields) {
      const entry = { id: `${++sequence}-0`, fields, delivered: false, deliveries: 0 }
      entries.push(entry)
      return entry.id
    },
    failNext(method, error) {
      failures.set(method, error)
    },
    pending() {
      return entries.filter((entry) => entry.delivered === true).length
    },
    async createGroup() {
      await failing('createGroup')
      this.groups++
    },
    async claim(consumer, minIdle, count) {
      await failing('claim')
      return entries
        .filter((entry) => entry.delivered === true && Date.now() - entry.since >= minIdle)
        .slice(0, count)
        .map((entry) => handOut(entry, consumer))
    },
    async read(consumer, count, block) {
      await failing('read')
      const fresh = entries.filter((entry) => entry.delivered === false).slice(0, count)
      // Like BLOCK: without it the loop would spin on an empty queue and starve the timers
      if (fresh.length === 0 && block != null) await sleep(block)
      return fresh.map((entry) => handOut(entry, consumer))
    },
    async own(consumer, count, after) {
      await failing('own')
      return entries
        .filter((entry) => entry.consumer === consumer && sequenceOf(entry.id) > sequenceOf(after))
        .slice(0, count)
        .map((entry) => handOut(entry, consumer))
    },
    async prune(consumer, idle) {
      await failing('prune')
      const removed = [...consumers.entries()]
        .filter(([name, seen]) => name !== consumer && Date.now() - seen >= idle)
        .filter(([name]) => entries.some((entry) => entry.consumer === name) === false)
        .map(([name]) => name)

      for (const name of removed) consumers.delete(name)
      return removed
    },
    async deliveries(id) {
      await failing('deliveries')
      return entries.find((entry) => entry.id === id)?.deliveries ?? 0
    },
    async ack(ids) {
      await failing('ack')
      for (const id of ids) {
        const index = entries.findIndex((entry) => entry.id === id)
        if (index !== -1) entries.splice(index, 1)
      }
    },
  }
}

// What the API would enqueue for a view: the polished input, the clientId, an id and the
// time of the request
const view = (domainId, overrides = {}) => {
  const now = Date.now()

  return {
    id: uuid(),
    clientId: `client-${uuid()}`,
    domainId,
    siteLocation: 'https://example.com/',
    siteReferrer: 'https://google.com/',
    siteLanguage: 'en',
    screenWidth: 1920,
    screenHeight: 1080,
    deviceName: 'iPhone',
    osName: 'iOS',
    browserName: 'Safari',
    created: now - minute,
    updated: now - minute,
    ...overrides,
  }
}

const delta = (counters, before, key) => (counters[key] ?? 0) - (before[key] ?? 0)

const snapshot = () => ({ processed: { ...stats.processed }, dropped: { ...stats.dropped } })

// Record.create fails as it does while MongoDB is away, for the given records only
const failInsertsOf = (ids) => {
  const insertOne = Record.collection.insertOne.bind(Record.collection)

  Record.collection.insertOne = (document, ...rest) => {
    if (ids.includes(document.id)) return Promise.reject(new MongoNetworkError('connection lost'))
    return insertOne(document, ...rest)
  }

  return () => delete Record.collection.insertOne
}

test.before(async () => {
  await connect((await mongoDb).getUri())
  // The unique index on id must exist before a duplicate can be told apart
  await Record.init()
})

test.after.always(async () => {
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

test.beforeEach(async (t) => {
  t.context.domain = await Domain.create({ title: 'example.com', workspaceId: uuid() })
  t.context.queue = createQueue()
})

test.afterEach.always(async () => {
  await Record.deleteMany({})
  await Domain.deleteMany({})
})

test('encodes a create with the time the API took it and decodes it back', (t) => {
  const data = view('domain', { created: new Date('2026-10-22T10:00:00Z'), updated: new Date('2026-10-22T10:00:00Z') })
  const fields = recordCreate(data)

  t.is(fields.v, INGEST_VERSION)
  t.is(fields.type, RECORD_CREATE)
  t.is(fields.at, String(Date.parse('2026-10-22T10:00:00Z')))
  t.true(Object.values(fields).every((value) => typeof value === 'string'))

  const message = decode({ id: '1-0', fields })

  t.is(message.type, RECORD_CREATE)
  t.deepEqual(message.at, new Date('2026-10-22T10:00:00Z'))
  t.is(message.data.id, data.id)
  t.is(message.data.created, Date.parse('2026-10-22T10:00:00Z'))
})

test('encodes a touch with the id and the new updated only', (t) => {
  const message = decode({ id: '1-0', fields: recordTouch('record-id', 1000) })

  t.is(message.type, RECORD_TOUCH)
  t.deepEqual(message.data, { id: 'record-id', updated: 1000 })
  t.deepEqual(message.at, new Date(1000))
})

test('rejects messages it cannot read, each with its reason', (t) => {
  const fields = recordTouch('record-id', 1000)
  const reasonOf = (changes) => {
    const error = t.throws(() => decode({ id: '1-0', fields: { ...fields, ...changes } }), {
      instanceOf: PoisonError,
    })
    return error.reason
  }

  t.is(reasonOf({ v: undefined }), 'malformed')
  t.is(reasonOf({ v: '2' }), 'unknown_version')
  t.is(reasonOf({ type: 'action.create' }), 'unknown_type')
  t.is(reasonOf({ at: 'soon' }), 'malformed')
  t.is(reasonOf({ data: '{' }), 'malformed')
  t.is(reasonOf({ data: '[]' }), 'malformed')
  t.is(reasonOf({ data: '{"updated":1000}' }), 'malformed')
  // A touch without a date would be stored with the time of the write, or with 1970
  t.is(reasonOf({ data: '{"id":"record-id"}' }), 'malformed')
  t.is(reasonOf({ data: '{"id":"record-id","updated":null}' }), 'malformed')
  t.is(reasonOf({ data: '{"id":"record-id","updated":"1000"}' }), 'malformed')

  const create = recordCreate(view('domain'))
  const createReasonOf = (changes) =>
    t.throws(() =>
      decode({ id: '1-0', fields: { ...create, data: JSON.stringify({ ...JSON.parse(create.data), ...changes }) } }),
    ).reason

  // Without them a create would get the defaults of the model
  t.is(createReasonOf({ created: undefined }), 'malformed')
  t.is(createReasonOf({ updated: null }), 'malformed')
  t.is(t.throws(() => decode({ id: '1-0' })).reason, 'malformed')
})

test.serial('validates a record without storing it', async (t) => {
  const data = view(t.context.domain.id)
  const entry = await records.validate(data)

  t.is(entry.id, data.id)
  t.deepEqual(entry.created, new Date(data.created))
  t.is(await Record.countDocuments(), 0)

  const error = await t.throwsAsync(records.validate({ ...data, siteLocation: 'not a url' }))
  t.is(error.name, 'ValidationError')
})

test.serial('stores a view with the id and the dates from the message', async (t) => {
  const { queue, domain } = t.context
  const before = snapshot()
  const data = view(domain.id)

  queue.add(recordCreate(data))
  await drain(queue)

  const stored = await Record.findOne({ id: data.id }).lean()

  t.deepEqual(stored.created, new Date(data.created))
  t.deepEqual(stored.updated, new Date(data.updated))
  t.is(stored.clientId, data.clientId)
  t.is(stored.browserName, 'Safari')
  t.is(queue.entries.length, 0)
  t.is(delta(stats.processed, before.processed, RECORD_CREATE), 1)
})

test.serial('anonymizes the earlier views of the visitor, like the direct path', async (t) => {
  const { queue, domain } = t.context
  // Older than the next view, so the order is the same on every run
  const first = view(domain.id, { clientId: 'visitor', created: Date.now() - 2 * minute })
  const second = view(domain.id, { clientId: 'visitor' })

  queue.add(recordCreate(first))
  queue.add(recordCreate(second))
  await drain(queue)

  const earlier = await Record.findOne({ id: first.id }).lean()
  const latest = await Record.findOne({ id: second.id }).lean()

  t.is(earlier.clientId, null)
  t.is(earlier.browserName, null)
  t.is(earlier.siteLocation, 'https://example.com/')
  t.is(latest.clientId, 'visitor')
  t.is(latest.browserName, 'Safari')
})

test.serial('a redelivered view is stored once and still anonymizes', async (t) => {
  const { queue, domain } = t.context
  // Older than the next view, so the order is the same on every run
  const earlier = view(domain.id, { clientId: 'visitor', created: Date.now() - 2 * minute })
  const data = view(domain.id, { clientId: 'visitor' })

  // The first delivery wrote the record and died before the anonymization and the ack
  await Record.create([earlier, data])
  queue.add(recordCreate(data))
  queue.add(recordCreate(data))
  await drain(queue)

  t.is(await Record.countDocuments({ id: data.id }), 1)
  t.is((await Record.findOne({ id: earlier.id }).lean()).clientId, null)
  t.is((await Record.findOne({ id: data.id }).lean()).clientId, 'visitor')
  t.is(queue.entries.length, 0)
})

test.serial('a late redelivery of an older view leaves the newer view of the visitor alone', async (t) => {
  const { queue, domain } = t.context
  const older = view(domain.id, { clientId: 'visitor', created: Date.now() - 2 * minute })
  const newer = view(domain.id, { clientId: 'visitor' })

  // The older view was claimed back from a dead consumer after the newer one was written
  queue.add(recordCreate(newer))
  queue.add(recordCreate(older))
  await drain(queue)

  const kept = await Record.findOne({ id: newer.id }).lean()
  const forgotten = await Record.findOne({ id: older.id }).lean()

  t.is(kept.clientId, 'visitor')
  t.is(kept.browserName, 'Safari')
  t.is(kept.deviceName, 'iPhone')
  t.is(forgotten.clientId, null)
  t.is(forgotten.browserName, null)
  t.is(forgotten.siteLocation, 'https://example.com/')
  t.is(queue.entries.length, 0)
})

for (const order of ['first', 'second']) {
  test.serial(
    `two views of the visitor in the same millisecond leave one with the visitor (${order} queued first)`,
    async (t) => {
      const { queue, domain } = t.context
      const created = Date.now() - minute
      const views = [
        view(domain.id, { clientId: 'visitor', created }),
        view(domain.id, { clientId: 'visitor', created }),
      ]

      for (const data of order === 'first' ? views : views.toReversed()) queue.add(recordCreate(data))
      await drain(queue)

      const stored = await Record.find({ id: { $in: views.map((data) => data.id) } }).lean()

      t.is(stored.length, 2)
      t.is(stored.filter((entry) => entry.clientId === 'visitor').length, 1)
      t.is(stored.filter((entry) => entry.browserName === 'Safari').length, 1)
    },
  )
}

test.serial('a touch moves updated forward and never back', async (t) => {
  const { queue, domain } = t.context
  const data = view(domain.id)
  const later = data.created + 30_000

  queue.add(recordCreate(data))
  queue.add(recordTouch(data.id, later))
  // A redelivered older touch arrives after the newer one
  queue.add(recordTouch(data.id, data.created + 15_000))
  await drain(queue)

  t.deepEqual((await Record.findOne({ id: data.id }).lean()).updated, new Date(later))
  t.is(queue.entries.length, 0)
})

test.serial('the direct path still sets updated to now', async (t) => {
  const data = view(t.context.domain.id)
  await Record.create(data)

  const before = Date.now()
  const entry = await records.update(data.id)

  t.true(entry.updated.getTime() >= before)
  t.is(await records.update(uuid()), null)
})

test.serial('a touch that overtook its create waits for it', async (t) => {
  const { queue, domain } = t.context
  const data = view(domain.id)
  const touched = data.created + 15_000

  queue.add(recordTouch(data.id, touched))
  const [entry] = await queue.read('worker', 10)

  t.is(await processBatch([entry], queue), undefined)
  t.is(queue.pending(), 1)

  queue.add(recordCreate(data))
  await drain(queue)

  t.deepEqual((await Record.findOne({ id: data.id }).lean()).updated, new Date(touched))
  t.is(queue.entries.length, 0)
})

test.serial('a touch of a record that never comes is dropped after the last delivery', async (t) => {
  const { queue } = t.context
  const before = snapshot()

  queue.add(recordTouch(uuid(), Date.now()))
  await drain(queue)

  t.is(queue.entries.length, 0)
  t.is(delta(stats.dropped, before.dropped, 'unknown_record'), 1)
  t.is(delta(stats.processed, before.processed, RECORD_TOUCH), 0)
})

test.serial('the touch is kept for exactly the allowed deliveries', async (t) => {
  const { queue } = t.context

  queue.add(recordTouch(uuid(), Date.now()))
  let batch = await queue.read('worker', 1)

  for (let delivery = 1; delivery < INGEST_MAX_DELIVERIES; delivery++) {
    await processBatch(batch, queue)
    t.is(queue.entries.length, 1, `delivery ${delivery}`)
    batch = await queue.claim('worker', 0, 1)
  }

  await processBatch(batch, queue)
  t.is(queue.entries.length, 0)
})

test.serial('drops poisoned messages and goes on with the rest of the batch', async (t) => {
  const { queue, domain } = t.context
  const before = snapshot()
  const good = view(domain.id)

  queue.add({ ...recordCreate(view(domain.id)), v: '2' })
  queue.add({ ...recordCreate(view(domain.id)), type: 'action.create' })
  queue.add({ ...recordCreate(view(domain.id)), data: 'not json' })
  queue.add(recordCreate(view(domain.id, { siteLocation: 'not a url' })))
  queue.add(recordCreate(view(domain.id, { screenWidth: 'wide' })))
  queue.add({ ...recordTouch(good.id, 1000), data: JSON.stringify({ id: good.id, updated: 'yesterday' }) })
  queue.add(recordCreate(good))
  await drain(queue)

  t.is(queue.entries.length, 0)
  t.is(await Record.countDocuments(), 1)
  t.is(await Record.countDocuments({ id: good.id }), 1)
  t.is(delta(stats.dropped, before.dropped, 'unknown_version'), 1)
  t.is(delta(stats.dropped, before.dropped, 'unknown_type'), 1)
  t.is(delta(stats.dropped, before.dropped, 'malformed'), 2)
  t.is(delta(stats.dropped, before.dropped, 'invalid'), 2)
})

test.serial('drops the views of a domain deleted while they waited', async (t) => {
  const { queue, domain } = t.context
  const before = snapshot()
  const kept = view(domain.id)

  queue.add(recordCreate(view(uuid())))
  queue.add(recordCreate(kept))
  await drain(queue)

  t.is(await Record.countDocuments(), 1)
  t.is(await Record.countDocuments({ id: kept.id }), 1)
  t.is(delta(stats.dropped, before.dropped, 'unknown_domain'), 1)
})

test.serial('an outage acknowledges what was written and keeps the rest, stored once later', async (t) => {
  const { queue, domain } = t.context
  const batch = [view(domain.id), view(domain.id), view(domain.id)]

  for (const data of batch) queue.add(recordCreate(data))

  const restore = failInsertsOf([batch[1].id])
  t.teardown(restore)

  const outage = await processBatch(await queue.read('worker', 10), queue)

  t.is(outage.name, 'MongoNetworkError')
  t.is(await Record.countDocuments(), 1)
  t.is(queue.entries.length, 2)
  t.is(queue.pending(), 2)

  await t.throwsAsync(drain(queue, { minIdle: 0 }), { message: 'connection lost' })

  restore()
  await drain(queue)

  t.is(await Record.countDocuments(), 3)
  t.deepEqual(
    (await Record.find().lean()).map((entry) => entry.id).toSorted(),
    batch.map((entry) => entry.id).toSorted(),
  )
  t.is(queue.entries.length, 0)
})

test.serial('a failed ack leaves the batch to be redelivered without duplicates', async (t) => {
  const { queue, domain } = t.context
  const batch = [view(domain.id), view(domain.id)]

  for (const data of batch) queue.add(recordCreate(data))
  queue.failNext('ack', new Error('Redis went away'))

  await t.throwsAsync(drain(queue), { message: 'Redis went away' })
  t.is(await Record.countDocuments(), 2)
  t.is(queue.entries.length, 2)

  await drain(queue)

  t.is(await Record.countDocuments(), 2)
  t.is(queue.entries.length, 0)
})

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await condition()) === true) return
    await sleep(10)
  }

  throw new Error('Condition not met in time')
}

test.serial('the loop writes what arrives until it is stopped', async (t) => {
  const { queue, domain } = t.context
  const worker = start(queue, { block: 5, retryDelay: 10 })

  for (let index = 0; index < 5; index++) queue.add(recordCreate(view(domain.id)))
  await waitFor(async () => (await Record.countDocuments()) === 5)

  await worker.stop()
  queue.add(recordCreate(view(domain.id)))
  await sleep(30)

  t.is(await Record.countDocuments(), 5)
  t.is(queue.entries.length, 1)
  t.is(queue.groups, 1)
})

test.serial('the loop waits out an outage and claims the pending entries back first', async (t) => {
  const { queue, domain } = t.context
  const batch = [view(domain.id), view(domain.id)]

  for (const data of batch) queue.add(recordCreate(data))

  const restore = failInsertsOf([batch[0].id])
  t.teardown(restore)

  // A minute of idle time would keep the entries pending; after an outage the retry delay counts
  const worker = start(queue, { block: 5, retryDelay: 20, minIdle: minute })
  t.teardown(worker.stop)

  await waitFor(() => queue.pending() === 2)
  restore()

  await waitFor(async () => (await Record.countDocuments()) === 2)
  await worker.stop()

  t.is(queue.entries.length, 0)
})

test.serial('the loop survives Redis going away and creates the group anew', async (t) => {
  const { queue, domain } = t.context

  queue.failNext('createGroup', new Error('connection refused'))
  const worker = start(queue, { block: 5, retryDelay: 10 })
  t.teardown(worker.stop)

  await waitFor(() => queue.groups === 1)
  queue.failNext('read', new Error('NOGROUP'))
  queue.add(recordCreate(view(domain.id)))

  await waitFor(async () => (await Record.countDocuments()) === 1)
  await worker.stop()

  t.is(queue.groups, 2)
})

test.serial('stop does not wait for the retry delay', async (t) => {
  const { queue } = t.context

  queue.failNext('createGroup', new Error('connection refused'))
  const worker = start(queue, { retryDelay: minute })

  await sleep(10)
  const started = Date.now()
  await worker.stop()

  t.true(Date.now() - started < 1000)
})

test.serial('a restarted worker writes what it held before at once, and leaves the others theirs', async (t) => {
  const { queue, domain } = t.context
  const mine = view(domain.id)
  const theirs = view(domain.id)

  // The previous run of this consumer and a live process each read one entry
  queue.add(recordCreate(mine))
  queue.add(recordCreate(theirs))
  await queue.read('host', 1)
  await queue.read('other-host', 1)

  const worker = start(queue, { consumer: 'host', block: 5, retryDelay: 10, minIdle: minute })
  t.teardown(worker.stop)

  await waitFor(async () => (await Record.countDocuments({ id: mine.id })) === 1)
  await worker.stop()

  t.is(await Record.countDocuments({ id: theirs.id }), 0)
  t.deepEqual(
    queue.entries.map((entry) => entry.consumer),
    ['other-host'],
  )
})

test.serial('a restarted worker steps over a touch that still waits for its create', async (t) => {
  const { queue, domain } = t.context
  const data = view(domain.id)

  queue.add(recordTouch(uuid(), Date.now()))
  queue.add(recordCreate(data))
  await queue.read('host', 2)

  const worker = start(queue, { consumer: 'host', block: 5, retryDelay: 10, minIdle: minute })
  t.teardown(worker.stop)

  await waitFor(async () => (await Record.countDocuments({ id: data.id })) === 1)
  await worker.stop()

  t.is(queue.entries.length, 1)
  t.is(queue.entries[0].fields.type, RECORD_TOUCH)
})

test.serial('the worker forgets consumers that are gone and hold nothing', async (t) => {
  const { queue, domain } = t.context

  queue.add(recordCreate(view(domain.id)))
  queue.add(recordCreate(view(domain.id)))
  await queue.read('gone', 1)
  await queue.ack(queue.entries.slice(0, 1).map((entry) => entry.id))
  await queue.read('busy', 1)
  queue.consumers.set('gone', Date.now() - 2 * minute)
  queue.consumers.set('busy', Date.now() - 2 * minute)

  const worker = start(queue, { consumer: 'host', block: 5, retryDelay: 10, consumerTtl: minute })
  t.teardown(worker.stop)

  await waitFor(() => queue.consumers.has('gone') === false)
  await worker.stop()

  // The busy one still held an entry when it was checked, so it was kept
  t.true(queue.consumers.has('busy'))
})

test.serial('a failed cleanup does not stop the worker', async (t) => {
  const { queue, domain } = t.context

  queue.failNext('prune', new Error('NOSCRIPT'))
  queue.add(recordCreate(view(domain.id)))

  const worker = start(queue, { block: 5, retryDelay: 10 })
  t.teardown(worker.stop)

  await waitFor(async () => (await Record.countDocuments()) === 1)
  await worker.stop()

  t.is(queue.groups, 1)
})

// Domain.find fails as it does while MongoDB is away
const failDomainLookups = () => {
  Domain.find = () => {
    throw new MongoNetworkError('connection lost')
  }

  return () => delete Domain.find
}

// Collects what the worker logs as an error, without printing it
const captureErrors = () => {
  const lines = []
  const original = signale.error

  signale.error = (message) => lines.push(message)

  return { lines, restore: () => (signale.error = original) }
}

test.serial('MongoDB away before the batch is checked acknowledges nothing', async (t) => {
  const { queue, domain } = t.context

  queue.add(recordCreate(view(domain.id)))
  queue.add(recordCreate(view(domain.id)))

  const restore = failDomainLookups()
  t.teardown(restore)

  const outage = await processBatch(await queue.read('worker', 10), queue)

  t.is(outage.name, 'MongoNetworkError')
  t.is(queue.pending(), 2)
  t.is(await Record.countDocuments(), 0)

  restore()
  await drain(queue)
  t.is(await Record.countDocuments(), 2)
})

test.serial('a lasting outage is logged as a failed batch, once and not on every retry', async (t) => {
  const { queue, domain } = t.context
  const errors = captureErrors()
  t.teardown(errors.restore)

  queue.add(recordCreate(view(domain.id)))

  const restore = failDomainLookups()
  t.teardown(restore)

  const worker = start(queue, { block: 5, retryDelay: 5 })
  t.teardown(worker.stop)

  // Retried every 5 ms, so about twenty times
  await sleep(100)
  restore()
  await waitFor(async () => (await Record.countDocuments()) === 1)
  await worker.stop()
  errors.restore()

  t.is(errors.lines.length, 1)
  t.regex(errors.lines[0], /^Ingest batch not fully written, retrying every 5 ms: connection lost$/)
})

test.serial('a new outage after the worker recovered is logged at once', async (t) => {
  const { queue, domain } = t.context
  const errors = captureErrors()
  t.teardown(errors.restore)

  const worker = start(queue, { block: 5, retryDelay: 5 })
  t.teardown(worker.stop)

  for (let outage = 0; outage < 2; outage++) {
    const data = view(domain.id)
    const restore = failInsertsOf([data.id])
    queue.add(recordCreate(data))

    await waitFor(() => errors.lines.length === outage + 1)
    restore()
    await waitFor(async () => (await Record.countDocuments({ id: data.id })) === 1)
    // A round with nothing to write, so the worker is back to normal
    await sleep(30)
  }

  await worker.stop()
  errors.restore()

  t.is(errors.lines.length, 2)
  t.true(errors.lines.every((line) => line.startsWith('Ingest batch not fully written')))
})
