import { hostname } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  ack,
  claimStale,
  close as closeQueue,
  connect as connectQueue,
  createGroup,
  deliveries,
  readBatch,
  refreshLength,
  stats,
  trim,
} from './queue/redis.js'
import { flush } from './stores/clickhouse/writer.js'
import { closeEventStore, connectEventStore } from './stores/connect.js'
import { getEventStore } from './stores/index.js'
import config, {
  usesClickHouse,
  usesQueue,
  validateEventStoreConfig,
  validateIngestQueueConfig,
} from './utils/config.js'
import connect from './utils/connect.js'
import signale from './utils/signale.js'
import stripUrlAuth from './utils/stripUrlAuth.js'

export const maxDeliveries = 5
const defaultMinIdle = 60_000
const outageBackoff = 5000
const logEvery = 10
const retention = 24 * 60 * 60 * 1000

const isDuplicate = (error) => error.code === 11000

// Only errors known to be the message's own fault give it up; anything else is taken
// for a store outage and retried without limit, so an unforeseen failure stalls the
// stream loudly instead of silently dropping events
const poisonErrors = new Set(['SyntaxError', 'ValidationError', 'CastError', 'UnknownTypeError'])

const isPoison = (error) => poisonErrors.has(error.name)

// A touch can overtake its create only through a redelivery, so it is worth a few more
// deliveries before it is given up
const isRetriable = (error) => error.name === 'UnknownEntryError'

const namedError = (name, message) => Object.assign(new Error(message), { name })

const handlers = {
  'record.create': async (store, payload) => {
    try {
      await store.addRecord(payload)
    } catch (error) {
      if (isDuplicate(error) === false) throw error

      // A redelivery after a crash between the MongoDB write and the ack: ClickHouse may
      // have missed the unflushed row, so the record is pushed again as it is now
      await store.mirrorRecord(payload.id)
    }

    // Repeated on a redelivery too, the first delivery may have died before it: the
    // earlier records of the visitor are already anonymized then and nothing matches
    await store.anonymize(payload.clientId, payload.id)
  },
  'record.touch': async (store, { id, updated }) => {
    const entry = await store.touchRecord(id, updated)
    if (entry == null) throw namedError('UnknownEntryError', `Unknown record '${id}'`)
  },
  'action.create': async (store, payload) => {
    try {
      await store.addAction(payload)
    } catch (error) {
      if (isDuplicate(error) === false) throw error
      await store.mirrorAction(payload.id)
    }
  },
  'action.touch': async (store, { id, ...data }) => {
    const entry = await store.touchAction(id, data)
    if (entry == null) throw namedError('UnknownEntryError', `Unknown action '${id}'`)
  },
}

const parsePayload = (payload) => {
  const data = JSON.parse(payload)
  if (data == null || typeof data !== 'object') throw new SyntaxError('Payload is not a JSON object')
  return data
}

// Same writes the resolvers make without the queue, replayed with the id and dates
// the API already answered to the tracker
export const handle = async (message, store = getEventStore()) => {
  const handler = handlers[message.type]
  if (handler == null) throw namedError('UnknownTypeError', `Unknown message type '${message.type}'`)

  await handler(store, parsePayload(message.payload))
}

const drop = (message, when, error) => {
  stats.dropped++
  signale.error(`Dropping message ${message.id} (${message.type}) ${when}: ${error.message}`)
}

const giveUp = async (message, error) => {
  const count = await deliveries(message.id)

  if (count < maxDeliveries) {
    signale.warn(
      `Message ${message.id} (${message.type}) failed on delivery ${count} of ${maxDeliveries}, will be retried: ${error.message}`,
    )
    return false
  }

  drop(message, `after ${count} failed deliveries`, error)
  return true
}

// A batch is acknowledged only after MongoDB has the writes and the ClickHouse buffer
// has been flushed, so a crash before the ack redelivers, never loses. A store outage
// stops the batch at once: what was written before it is acknowledged, the rest comes
// back first.
export const processBatch = async (messages, store = getEventStore()) => {
  const done = []
  let outage

  for (const message of messages) {
    try {
      await handle(message, store)
      stats.processed++
      done.push(message.id)
    } catch (error) {
      stats.failed++

      if (isPoison(error) === true) {
        drop(message, 'on its first delivery', error)
        done.push(message.id)
        continue
      }

      if (isRetriable(error) === true) {
        if ((await giveUp(message, error)) === true) done.push(message.id)
        continue
      }

      outage = error
      break
    }
  }

  if (usesClickHouse() === true) await flush()
  await ack(done)

  return outage
}

// Acknowledged entries still carry the visitor's clientId and device fields, so they
// are not left in Redis for longer than a day
const trimOld = async (lastId) => {
  try {
    await trim(Date.now() - retention, lastId)
  } catch (error) {
    signale.warn(`Trimming the stream failed: ${error.message}`)
  }
}

let isStopping = false

export const stop = () => {
  isStopping = true
}

const defaultConsumer = () => `${hostname()}-${process.pid}`

// `once` handles one batch, `until: 'empty'` returns when neither stale nor new
// messages are left, otherwise runs until stop() is called. Pending messages of a
// crashed worker are claimed once they are idle for `minIdle`; after an outage the
// worker's own unacknowledged messages have been idle for the backoff, so they are
// claimed with that threshold and replayed before newer messages.
export const run = async ({
  once = false,
  until,
  count = 1000,
  block = 1000,
  minIdle = defaultMinIdle,
  consumer = defaultConsumer(),
} = {}) => {
  isStopping = false
  await createGroup()

  let claimIdle = minIdle
  let batches = 0

  while (isStopping === false) {
    let messages

    try {
      const stale = await claimStale(consumer, claimIdle, count)
      const fresh = stale.length < count ? await readBatch(consumer, { count: count - stale.length, block }) : []
      messages = [...stale, ...fresh]
    } catch (error) {
      signale.error(`Reading the queue failed, retrying in ${outageBackoff} ms: ${error.message}`)
      await sleep(outageBackoff)
      continue
    }

    claimIdle = minIdle

    if (messages.length === 0) {
      await trimOld()
      if (once === true || until === 'empty') break
      continue
    }

    let outage

    try {
      outage = await processBatch(messages)
    } catch (error) {
      outage = error
    }

    batches++

    if (outage == null) {
      await trimOld(messages.at(-1).id)
    } else {
      claimIdle = outageBackoff
      signale.error(`Batch not acknowledged, retrying in ${outageBackoff} ms: ${outage.message}`)
      await sleep(outageBackoff)
    }

    if (batches % logEvery === 0) {
      await refreshLength()
      signale.info(
        `Processed ${stats.processed} messages (${stats.failed} failed deliveries, ${stats.dropped} dropped), ${stats.length} in the stream`,
      )
    }

    if (once === true) break
  }
}

const validateConfig = () => {
  if (config.dbUrl == null) throw new Error('MongoDB connection URI missing in environment')

  validateEventStoreConfig()
  validateIngestQueueConfig()

  if (usesQueue() === false) throw new Error(`ACKEE_INGEST_QUEUE must be 'redis' to run the worker`)
}

const main = async () => {
  signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)
  await connect(config.dbUrl)
  signale.success(`Connected to ${stripUrlAuth(config.dbUrl)}`)
  await connectEventStore()

  signale.await(`Connecting to Redis at ${stripUrlAuth(config.redisUrl)}`)
  await connectQueue()
  signale.success(`Redis is ready (stream: ${config.redisStream})`)

  // The current batch finishes and is acknowledged, then the buffers are flushed
  const shutdown = (signal) => {
    signale.await(`Received ${signal}, finishing the current batch`)
    stop()
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  signale.start(`Worker '${defaultConsumer()}' is reading ${config.redisStream}`)
  await run()

  await closeEventStore()
  await closeQueue()
  signale.info(`Processed ${stats.processed} messages (${stats.failed} failed deliveries, ${stats.dropped} dropped)`)
}

if (import.meta.main === true) {
  try {
    validateConfig()
  } catch (error) {
    signale.fatal(error.message)
    process.exit(1)
  }

  main()
    .then(() => process.exit(0))
    .catch((error) => {
      signale.fatal(error)
      process.exit(1)
    })
}
