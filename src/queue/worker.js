import { hostname } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  DROP_INVALID,
  DROP_UNKNOWN_DOMAIN,
  DROP_UNKNOWN_RECORD,
  INGEST_BATCH_SIZE,
  INGEST_BLOCK,
  INGEST_CLEANUP_INTERVAL,
  INGEST_CONSUMER_TTL,
  INGEST_MAX_DELIVERIES,
  INGEST_MIN_IDLE,
  INGEST_RETRY_DELAY,
  RECORD_CREATE,
  RECORD_TOUCH,
} from '../constants/ingest.js'
import * as domains from '../database/domains.js'
import * as records from '../database/records.js'
import signale from '../utils/signale.js'
import sometimes from '../utils/sometimes.js'
import { minute } from '../utils/times.js'
import { decode, PoisonError } from './messages.js'

/*
 * Writes the events of the ingest queue to MongoDB (ADR-006).
 *
 * The queue itself is an adapter, so the delivery rules below work the same against Redis
 * and against the fake in the tests. Entries are { id, fields }, oldest first:
 *
 *   createGroup()                      creates the consumer group, if there is none yet
 *   claim(consumer, minIdle, count)    entries other deliveries left unacknowledged for minIdle
 *   read(consumer, count, block)       new entries, waiting up to block ms; null waits not at all
 *   own(consumer, count, after)        entries handed to this consumer and not acknowledged, after the id
 *   deliveries(id)                     how often the entry was handed out
 *   ack(ids)                           acknowledges and deletes the entries
 *   prune(consumer, idle)              forgets other consumers idle that long and holding nothing,
 *                                      returns their names
 */

// Counted by type and by reason, read by /metrics
export const stats = { processed: {}, dropped: {} }

const count = (counters, key) => {
  counters[key] = (counters[key] ?? 0) + 1
}

// Only errors that are the message's own fault give it up. Anything else is taken for an
// outage and retried without limit, so an unforeseen failure stalls the queue loudly
// instead of losing events.
const invalidErrors = new Set(['ValidationError', 'CastError'])

const toPoison = (error) => {
  if (error instanceof PoisonError) return error
  if (invalidErrors.has(error.name) === true) return new PoisonError(DROP_INVALID, error.message)
}

class UnknownRecordError extends Error {
  constructor(id) {
    super(`Unknown record '${id}'`)
    this.name = 'UnknownRecordError'
  }
}

const handlers = {
  [RECORD_CREATE]: (data) => records.addOnce(data),
  [RECORD_TOUCH]: async ({ id, updated }) => {
    const entry = await records.update(id, updated)

    // The tracker sends a touch only after the create was answered, so a touch can overtake
    // its create only through a redelivery. It waits for a few more deliveries.
    if (entry == null) throw new UnknownRecordError(id)
  },
}

// Drops a message for good and counts it. Made once per worker run, so the log is limited per
// process, as the outages of its loop are.
export const createDrop = (now = Date.now) => {
  // The updateRecord mutation needs no sign-in, so anyone can send touches of made-up ids.
  // They are summed up in a line a minute; the other reasons are bugs or foreign entries.
  const unknownSometimes = sometimes(minute, now)
  let unknown = 0

  return (entry, error) => {
    count(stats.dropped, error.reason)

    if (error.reason !== DROP_UNKNOWN_RECORD) {
      signale.error(`Dropping ingest message ${entry.id} (${error.reason}): ${error.message}`)
      return
    }

    unknown++
    unknownSometimes(DROP_UNKNOWN_RECORD, () => {
      signale.error(
        `Dropped ingest touches of unknown records (${DROP_UNKNOWN_RECORD}): ${unknown} since the last such line, the latest ${entry.id}: ${error.message}`,
      )
      unknown = 0
    })
  }
}

// True when the entry is done with: it is dropped on its last allowed delivery. Until then it
// waits silently, a line per delivery would let anyone flood the log.
const givesUp = async (entry, error, adapter, drop) => {
  if ((await adapter.deliveries(entry.id)) < INGEST_MAX_DELIVERIES) return false

  drop(entry, new PoisonError(DROP_UNKNOWN_RECORD, error.message))
  return true
}

const decodeAll = (entries) =>
  entries.map((entry) => {
    try {
      return { entry, message: decode(entry) }
    } catch (error) {
      return { entry, error }
    }
  })

// The domains of a batch are checked with a single query, not one per event
const existingDomains = (decoded) => {
  const ids = decoded
    .filter(({ message }) => message?.type === RECORD_CREATE)
    .map(({ message }) => message.data.domainId)

  return ids.length === 0 ? new Set() : domains.existingUnscoped([...new Set(ids)])
}

const handle = async ({ entry, message, error }, existing) => {
  if (error != null) throw error

  if (message.type === RECORD_CREATE && existing.has(message.data.domainId) === false) {
    throw new PoisonError(DROP_UNKNOWN_DOMAIN, `Domain '${message.data.domainId}' of message ${entry.id} is gone`)
  }

  await handlers[message.type](message.data)
}

// Entries are acknowledged only after they are written, so a crash before the ack
// redelivers and never loses. An outage stops the batch at once: what was written before it
// is acknowledged, the rest stays pending and comes back first. Returns the outage, if any.
export const processBatch = async (entries, adapter, drop = createDrop()) => {
  const decoded = decodeAll(entries)
  let existing

  try {
    existing = await existingDomains(decoded)
  } catch (error) {
    // MongoDB is away before anything was written, so nothing is acknowledged
    return error
  }

  const done = []
  let outage

  for (const item of decoded) {
    try {
      await handle(item, existing)
      count(stats.processed, item.message.type)
      done.push(item.entry.id)
    } catch (error) {
      const poison = toPoison(error)

      if (poison != null) {
        drop(item.entry, poison)
        done.push(item.entry.id)
        continue
      }

      if (error instanceof UnknownRecordError) {
        if ((await givesUp(item.entry, error, adapter, drop)) === true) done.push(item.entry.id)
        continue
      }

      outage = error
      break
    }
  }

  await adapter.ack(done)

  return outage
}

// Stale entries first, they are older than everything not yet handed out. Waiting for new
// ones would only hold the stale ones back.
const round = async (adapter, { consumer, count, block, minIdle }, drop) => {
  const stale = await adapter.claim(consumer, minIdle, count)
  const room = count - stale.length
  const fresh = room > 0 ? await adapter.read(consumer, room, stale.length === 0 ? block : null) : []
  const entries = [...stale, ...fresh]

  if (entries.length === 0) return { size: 0 }

  return { size: entries.length, outage: await processBatch(entries, adapter, drop) }
}

// Whatever this consumer was handed and never acknowledged: the batch an outage stopped, or
// the entries of its previous run under the same name. Read once, oldest first, before
// anything new, instead of waiting INGEST_MIN_IDLE for them. Returns the outage, if any.
const recover = async (adapter, { consumer, count }, drop) => {
  let after = '0'

  for (;;) {
    const entries = await adapter.own(consumer, count, after)
    if (entries.length === 0) return

    const outage = await processBatch(entries, adapter, drop)
    if (outage != null) return outage

    // A touch still waiting for its create stays pending, the cursor steps over it
    after = entries.at(-1).id
  }
}

// Forgetting a consumer drops whatever it still holds, so the adapter removes only those
// that hold nothing. A failure only leaves them listed, it is no reason to stop writing.
const prune = async (adapter, { consumer, consumerTtl }) => {
  try {
    const removed = await adapter.prune(consumer, consumerTtl)
    if (removed.length > 0) signale.info(`Removed gone ingest consumers: ${removed.join(', ')}`)
  } catch (error) {
    signale.warn(`Could not remove gone ingest consumers: ${error.message}`)
  }
}

// One consumer per process, named after the host so that a restarted process finds its own
// pending entries at once. What a process with another name left behind is claimed by the
// others after INGEST_MIN_IDLE.
const defaults = () => ({
  consumer: hostname(),
  count: INGEST_BATCH_SIZE,
  block: INGEST_BLOCK,
  minIdle: INGEST_MIN_IDLE,
  retryDelay: INGEST_RETRY_DELAY,
  consumerTtl: INGEST_CONSUMER_TTL,
  cleanupInterval: INGEST_CLEANUP_INTERVAL,
})

// Reads the queue until stop() is called. An outage of MongoDB or Redis is waited out: the
// worker retries after retryDelay and first goes through the entries the failed batch left
// pending.
export const start = (adapter, options = {}) => {
  const settings = { ...defaults(), ...options }
  const controller = new AbortController()
  const drop = createDrop()

  // The first line of an outage at once, then one a minute: it is retried every retryDelay
  const errorSometimes = sometimes(minute)
  const logError = (kind, error, message) =>
    errorSometimes(`${kind}:${error.name}`, () => signale.error(`${message}: ${error.message}`))

  const pause = () => sleep(settings.retryDelay, undefined, { signal: controller.signal }).catch(() => {})

  const loop = async () => {
    let hasGroup = false
    let recovering = true
    let pruned = -Infinity

    while (controller.signal.aborted === false) {
      try {
        if (hasGroup === false) {
          await adapter.createGroup()
          hasGroup = true
        }

        if (Date.now() - pruned >= settings.cleanupInterval) {
          pruned = Date.now()
          await prune(adapter, settings)
        }

        const outage =
          recovering === true ? await recover(adapter, settings, drop) : (await round(adapter, settings, drop)).outage

        if (outage == null) {
          // Only a round, not the recovery, proves the outage over: with nothing pending of
          // its own, the recovery succeeds even while MongoDB is still away
          if (recovering === false) errorSometimes.reset()
          recovering = false
          continue
        }

        logError('batch', outage, `Ingest batch not fully written, retrying every ${settings.retryDelay} ms`)
      } catch (error) {
        // The stream or the group may be gone after an outage of Redis
        hasGroup = false
        logError('worker', error, `Ingest worker failed, retrying every ${settings.retryDelay} ms`)
      }

      recovering = true
      await pause()
    }
  }

  const running = loop()

  // The current batch is finished and acknowledged before the promise resolves
  const stop = async () => {
    controller.abort()
    await running
  }

  return { stop }
}

// Works through the queue until nothing is left. Rejects on an outage instead of waiting
// it out, so a test or a script sees the failure.
export const drain = async (adapter, options = {}) => {
  const settings = { ...defaults(), block: null, minIdle: 0, ...options }
  const drop = createDrop()

  await adapter.createGroup()

  for (;;) {
    const { size, outage } = await round(adapter, settings, drop)

    if (outage != null) throw outage
    if (size === 0) return
  }
}
