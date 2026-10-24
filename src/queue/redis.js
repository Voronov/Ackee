import { createClient } from '@redis/client'

import {
  FALLBACK_FULL,
  FALLBACK_UNAVAILABLE,
  INGEST_ENQUEUE_TIMEOUT,
  INGEST_GROUP,
  INGEST_STREAM,
} from '../constants/ingest.js'
import config from '../utils/config.js'
import signale from '../utils/signale.js'
import sometimes from '../utils/sometimes.js'
import { minute, second } from '../utils/times.js'
import { start as startWorker } from './worker.js'

/*
 * The ingest queue on Redis Streams (ADR-006). The API appends events to the stream, the
 * worker of the same process reads them through a consumer group. Nothing here opens a
 * connection unless ACKEE_INGEST_QUEUE is set.
 */

export const isEnabled = () => config.ingestQueue != null

// Counted by reason, read by /metrics
export const stats = { fallback: {} }

// The URL as it may appear in a log
export const describe = (url) => {
  const parsed = new URL(url)
  parsed.username = ''
  parsed.password = ''
  return parsed.href
}

const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])

const instance = (url) => {
  const { hostname, port } = new URL(url)
  return `${loopback.has(hostname) ? 'localhost' : hostname}:${port || '6379'}`
}

// The queue is kept on disk, the salt must never get there (docs/Anonymization.md).
// Persistence is a setting of the whole instance, so the two cannot share one.
export const checkConfig = () => {
  if (isEnabled() === false) return

  // Throws on a URL that is not one, before anything connects
  const queue = instance(config.ingestQueue)

  if (config.redisUrl && instance(config.redisUrl) === queue) {
    throw new Error(
      'ACKEE_INGEST_QUEUE and ACKEE_REDIS point at the same Redis, the queue needs an instance of its own',
    )
  }
}

// Node reports a refused connection with an empty message
const reasonOf = (error) => error.message || error.code || error.name

const open = () => {
  const client = createClient({
    url: config.ingestQueue,
    // Commands fail at once while Redis is away instead of waiting for it: the tracker gets
    // its answer from the direct write, the worker sees the outage and waits it out.
    disableOfflineQueue: true,
    socket: { connectTimeout: second, reconnectStrategy: (retries) => Math.min(retries * 100, 2 * second) },
  })

  // Logged once per outage, not on every attempt to reconnect. Without a listener a lost
  // connection would crash the process.
  let down = false

  client.on('error', (error) => {
    if (down === true) return
    down = true
    signale.warn(`Ingest queue at ${describe(config.ingestQueue)} is unreachable: ${reasonOf(error)}`)
  })
  client.on('ready', () => {
    if (down === true) signale.info(`Ingest queue at ${describe(config.ingestQueue)} is back`)
    down = false
  })

  // Settles after the first attempt either way. Without waiting for it, the first event of a
  // process would be written directly only because the connection was still being opened.
  const attempt = new Promise((resolve) => {
    client.once('ready', resolve)
    client.once('error', resolve)
  })

  // Keeps reconnecting on its own, it only rejects when the client is closed
  client.connect().catch(() => {})

  return attempt.then(() => client)
}

let clients = {}

const apiClient = () => (clients.api ??= open())

// A blocking read holds its connection, so the worker has one of its own. Sharing one would
// make the tracker wait for the read.
const workerClient = () => (clients.worker ??= open())

export const close = async () => {
  const opened = Object.values(clients)
  clients = {}

  for (const client of opened) (await client).destroy()
}

// `maxmemory` with `noeviction` makes Redis refuse writes once it is full
export const fallbackReason = (error) =>
  error.message?.startsWith('OOM') === true ? FALLBACK_FULL : FALLBACK_UNAVAILABLE

const warnSometimes = sometimes(minute)

// The timeout option of the client only covers a command still waiting to be sent: once it is
// written, a Redis that is up but stuck keeps the caller waiting for as long as it is stuck.
// The tracker and a scrape must not wait for that, so the API bounds the whole call.
const withDeadline = (operation) => {
  let timer

  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`No answer from the ingest queue within ${INGEST_ENQUEUE_TIMEOUT} ms`)),
      INGEST_ENQUEUE_TIMEOUT,
    )
  })

  return Promise.race([operation(), deadline]).finally(() => clearTimeout(timer))
}

// True when the event is in the queue. False when it could not get there and the caller has
// to write it directly (ADR-006); the reason is counted and logged. An XADD that still lands
// after the deadline leaves the event in the queue as well, which the worker takes for a
// redelivery of a record already written.
export const enqueue = async (fields) => {
  try {
    await withDeadline(async () => (await apiClient()).xAdd(INGEST_STREAM, '*', fields))
    return true
  } catch (error) {
    const reason = fallbackReason(error)

    stats.fallback[reason] = (stats.fallback[reason] ?? 0) + 1
    warnSometimes(reason, () =>
      signale.warn(`Writing events directly, the ingest queue is ${reason}: ${reasonOf(error)}`),
    )

    return false
  }
}

// Acknowledged entries are deleted, so everything in the stream is still to be written
export const length = () => withDeadline(async () => (await apiClient()).xLen(INGEST_STREAM))

// The time of the oldest event not written yet, null when there is none
export const oldest = async () => {
  const [entry] = await withDeadline(async () => (await apiClient()).xRange(INGEST_STREAM, '-', '+', { COUNT: 1 }))
  if (entry == null) return null

  // An entry id starts with the milliseconds of XADD, close enough for a message without a time
  const at = Number(entry.message.at)
  return new Date(Number.isFinite(at) ? at : Number(entry.id.split('-')[0]))
}

const entriesOf = (messages) =>
  messages.filter((message) => message != null).map(({ id, message }) => ({ id, fields: message }))

const streamEntriesOf = (reply) => entriesOf(reply?.[0]?.messages ?? [])

// The check and the removal run as one script, so a consumer cannot be handed entries in
// between: removing a consumer drops what it holds, and nothing would deliver that again.
const pruneScript = `
local removed = {}
for _, fields in ipairs(redis.call('XINFO', 'CONSUMERS', KEYS[1], ARGV[1])) do
  local consumer = {}
  for index = 1, #fields, 2 do consumer[fields[index]] = fields[index + 1] end
  if consumer.name ~= ARGV[2] and consumer.pending == 0 and consumer.idle >= tonumber(ARGV[3]) then
    redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], consumer.name)
    table.insert(removed, consumer.name)
  end
end
return removed
`

// The queue as the worker sees it, see the contract in worker.js
export const adapter = (client = workerClient) => ({
  async createGroup() {
    try {
      // From 0, not $: events added before the first worker ever ran are not skipped
      await (await client()).xGroupCreate(INGEST_STREAM, INGEST_GROUP, '0', { MKSTREAM: true })
    } catch (error) {
      if (error.message.startsWith('BUSYGROUP') === false) throw error
    }
  },
  async claim(consumer, minIdle, count) {
    const reply = await (
      await client()
    ).xAutoClaim(INGEST_STREAM, INGEST_GROUP, consumer, minIdle, '0-0', {
      COUNT: count,
    })
    return entriesOf(reply.messages)
  },
  async read(consumer, count, block) {
    // BLOCK 0 would wait forever, so not waiting means leaving it out
    const options = block == null ? { COUNT: count } : { COUNT: count, BLOCK: block }
    return streamEntriesOf(
      await (await client()).xReadGroup(INGEST_GROUP, consumer, { key: INGEST_STREAM, id: '>' }, options),
    )
  },
  async own(consumer, count, after) {
    return streamEntriesOf(
      await (await client()).xReadGroup(INGEST_GROUP, consumer, { key: INGEST_STREAM, id: after }, { COUNT: count }),
    )
  },
  async deliveries(id) {
    const [entry] = await (await client()).xPendingRange(INGEST_STREAM, INGEST_GROUP, id, id, 1)
    return entry?.deliveriesCounter ?? 0
  },
  async ack(ids) {
    if (ids.length === 0) return
    await (await client()).multi().xAck(INGEST_STREAM, INGEST_GROUP, ids).xDel(INGEST_STREAM, ids).exec()
  },
  async prune(consumer, idle) {
    return (await client()).eval(pruneScript, {
      keys: [INGEST_STREAM],
      arguments: [INGEST_GROUP, consumer, String(idle)],
    })
  },
})

// Opens the connection of the API and starts the worker of this process
export const start = (options = {}) => {
  apiClient()

  const consumer = config.ingestConsumer == null ? {} : { consumer: config.ingestConsumer }
  return startWorker(adapter(), { ...consumer, ...options })
}
