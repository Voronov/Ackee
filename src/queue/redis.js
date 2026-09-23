import Redis from 'ioredis'

import { gauge, readCounter } from '../utils/metrics.js'
import config from '../utils/config.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'

export const group = 'ackee-workers'
const maxLength = 1_000_000

export const stats = { processed: 0, failed: 0, dropped: 0, length: 0 }

gauge('ackee_queue_length', 'Messages in the Redis ingestion stream not yet acknowledged', () => stats.length)
readCounter('ackee_queue_processed_total', 'Queue messages written to the event store', () => stats.processed)
readCounter('ackee_queue_failed_total', 'Queue message deliveries that failed', () => stats.failed)
readCounter(
  'ackee_queue_dropped_total',
  'Queue messages given up on after too many failed deliveries',
  () => stats.dropped,
)

let client
let lastError

// Node reports a refused connection as an AggregateError with an empty message
const describeError = (error) => error.message || error.code

// Commands must fail at once while Redis is away instead of piling up in the offline
// queue: the tracker gets an error and the worker loop sees the outage. ioredis keeps
// reconnecting on its own in the background.
const getClient = () => {
  if (client == null) {
    client = new Redis(config.redisUrl, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 })
    client.on('error', (error) => {
      lastError = error
      signale.error(`Redis: ${describeError(error)}`)
    })
  }

  return client
}

// The client rejects with a bare "Connection is closed", the reason is on the error event
export const connect = async () => {
  try {
    await getClient().connect()
  } catch (error) {
    const reason = lastError == null ? error.message : describeError(lastError)
    throw new Error(`Redis at ${stripUrlAuth(config.redisUrl)} is unreachable: ${reason}`)
  }
}

export const ping = async () => {
  await connect()
  await getClient().ping()
}

export const close = async () => {
  if (client == null) return

  await client.quit().catch(() => client.disconnect())
  client = undefined
}

export const enqueue = (type, payload) =>
  getClient().xadd(config.redisStream, 'MAXLEN', '~', maxLength, '*', 'type', type, 'payload', JSON.stringify(payload))

// The group starts at 0, not $: events enqueued before the first worker ever ran must
// not be skipped
export const createGroup = async () => {
  try {
    await getClient().xgroup('CREATE', config.redisStream, group, '0', 'MKSTREAM')
  } catch (error) {
    if (error.message.startsWith('BUSYGROUP') === false) throw error
  }
}

// Redis answers with flat [key, value, key, value] lists
const toEntry = (fields) => {
  const entry = {}
  for (let index = 0; index < fields.length; index += 2) entry[fields[index]] = fields[index + 1]
  return entry
}

// A message is [id, ['type', type, 'payload', json]]. The payload is parsed by the
// worker, so a message that is not JSON reaches the poison handling like any other error.
const toMessage = ([id, fields]) => {
  const entry = toEntry(fields)
  return { id, type: entry.type, payload: entry.payload }
}

export const readBatch = async (consumer, { count = 1000, block = 1000 } = {}) => {
  const result = await getClient().xreadgroup(
    'GROUP',
    group,
    consumer,
    'COUNT',
    count,
    'BLOCK',
    block,
    'STREAMS',
    config.redisStream,
    '>',
  )

  if (result == null) return []

  const [[, messages]] = result
  return messages.map(toMessage)
}

export const ack = async (ids) => {
  if (ids.length === 0) return

  await getClient().xack(config.redisStream, group, ...ids)
}

// Messages another consumer read but never acknowledged (a crashed worker) are handed
// over once they have been idle for minIdle
export const claimStale = async (consumer, minIdle, count = 1000) => {
  const [, messages] = await getClient().xautoclaim(config.redisStream, group, consumer, minIdle, '0-0', 'COUNT', count)
  return messages.map(toMessage)
}

const parseId = (id) => id.split('-').map(Number)

const olderId = (a, b) => {
  const [aTime, aSeq] = parseId(a)
  const [bTime, bSeq] = parseId(b)
  return aTime < bTime || (aTime === bTime && aSeq < bSeq) ? a : b
}

const nextId = (id) => {
  const [time, seq] = parseId(id)
  return `${time}-${seq + 1}`
}

// Drops entries older than `cutoff` (a millisecond time, entry ids start with one),
// but never an unacknowledged one: pending entries are older than everything not yet
// delivered, so the smallest pending id is the floor, and when nothing is pending the
// floor is the entry after the last delivered one. Exact trimming, because the
// approximate one only removes whole nodes and would keep a day-old entry sharing
// a node with fresh ones.
export const trim = async (cutoff, lastDelivered) => {
  const [pending, smallestPending] = await getClient().xpending(config.redisStream, group)

  const floor = (() => {
    if (pending > 0) return smallestPending
    if (lastDelivered != null) return nextId(lastDelivered)
  })()

  const minId = floor == null ? `${cutoff}-0` : olderId(`${cutoff}-0`, floor)

  await getClient().xtrim(config.redisStream, 'MINID', minId)
}

export const deliveries = async (id) => {
  const [entry] = await getClient().xpending(config.redisStream, group, id, id, 1)
  return entry == null ? 0 : entry[3]
}

// The backlog is what the group has not been handed yet (lag) plus what was handed
// out and not acknowledged (pending). XLEN would count acknowledged entries too, which
// stay in the stream up to the trim limit. Redis reports no lag after trimming has cut
// into undelivered entries; the whole stream is the upper bound then.
export const length = async () => {
  let groups

  try {
    groups = await getClient().xinfo('GROUPS', config.redisStream)
  } catch (error) {
    if (error.message.startsWith('ERR no such key') === true) return 0
    throw error
  }

  const info = groups.map(toEntry).find((entry) => entry.name === group)

  if (info == null || info.lag == null) return getClient().xlen(config.redisStream)

  return info.lag + info.pending
}

export const refreshLength = async () => {
  try {
    stats.length = await length()
  } catch (error) {
    signale.warn(`Could not read the queue length, reporting the last known value: ${error.message}`)
  }
}
