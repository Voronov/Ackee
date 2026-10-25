import {
  LIVE_BACKLOG_SIZE,
  LIVE_BATCH_SIZE,
  LIVE_BUFFER_GRACE,
  LIVE_BUFFER_SIZE,
  LIVE_POLL_ERROR,
  LIVE_POLL_GAP,
  LIVE_POLL_INTERVAL,
  LIVE_POLL_OK,
  LIVE_WINDOW,
} from '../constants/live.js'
import * as records from '../database/records.js'
import signale from '../utils/signale.js'
import { minute } from '../utils/times.js'

/*
 * The views behind every live stream of this process (ADR-007).
 *
 * One timer polls MongoDB for all watched domains at once, so the number of queries depends
 * on time alone, not on how many people watch. Polling rather than events in the process:
 * after ACKEE-19 the views are written by another process, and change streams would need a
 * replica set that `docker compose up` does not have.
 */
export const createHub = ({
  find = records.live,
  interval = LIVE_POLL_INTERVAL,
  lookback = LIVE_WINDOW,
  batch = LIVE_BATCH_SIZE,
  bufferSize = LIVE_BUFFER_SIZE,
  backlogSize = LIVE_BACKLOG_SIZE,
  grace = LIVE_BUFFER_GRACE,
  now = Date.now,
} = {}) => {
  // Subscribers by the domain they watch
  const watchers = new Map()
  // Recent visits by domain, the newest last, and since when nobody watches it
  const buffers = new Map()
  // The created time of every view delivered within the window, by key. A view stays in the
  // window for several ticks, and late views of the queue make `created` useless as a cursor.
  const seen = new Map()
  const stats = { polls: {} }

  let timer
  // Domains watched since the last tick. Their older views that do not fit in a batch are
  // history nobody was shown, not a gap in the stream.
  let joined = new Set()
  // Also while a tick waits for MongoDB, so there is never a second one in flight
  let active = false
  let warned = 0

  const prune = (current) => {
    for (const [key, created] of seen) {
      if (created <= current - lookback) seen.delete(key)
    }

    for (const [domainId, buffer] of buffers) {
      if (buffer.idleSince != null && current - buffer.idleSince > grace) buffers.delete(domainId)
    }
  }

  const deliver = (visit) => {
    const subscribers = watchers.get(visit.domainId)

    // The domain lost its last viewer while the query ran. Not marked as seen, so it comes
    // again to whoever watches it next.
    if (subscribers == null || seen.has(visit.key)) return

    seen.set(visit.key, visit.created.getTime())

    const { visits } = buffers.get(visit.domainId)
    visits.push(visit)
    if (visits.length > bufferSize) visits.shift()

    for (const subscriber of subscribers) subscriber.visit(visit)
  }

  const count = (outcome) => {
    stats.polls[outcome] = (stats.polls[outcome] ?? 0) + 1
  }

  const schedule = (delay) => {
    timer = setTimeout(tick, delay)
    timer.unref()
  }

  const tick = async () => {
    timer = undefined
    const current = now()
    const fresh = joined
    joined = new Set()

    try {
      // Newest first: the window holds views of earlier ticks too, and they must not crowd out new ones
      const visits = await find([...watchers.keys()], new Date(current - lookback), batch)

      // A full batch that reaches back to a view already sent covers everything new in between
      const oldest = visits.at(-1)
      const gap = visits.length >= batch && seen.has(oldest.key) === false && fresh.has(oldest.domainId) === false

      prune(current)
      for (const visit of visits.toReversed()) deliver(visit)

      // What did not fit may belong to any domain, so every viewer learns about it. Once: a viewer
      // of several domains is in the set of each of them.
      if (gap) {
        const subscribers = new Set([...watchers.values()].flatMap((entries) => [...entries]))
        for (const subscriber of subscribers) subscriber.gap()
      }

      count(gap ? LIVE_POLL_GAP : LIVE_POLL_OK)
    } catch (error) {
      count(LIVE_POLL_ERROR)

      // Retried on the next tick, so a MongoDB outage would log every two seconds otherwise
      if (current - warned >= minute) {
        warned = current
        signale.warn(`Live feed could not read views: ${error.message}`)
      }
    }

    if (watchers.size > 0) return schedule(interval)

    active = false
  }

  const watch = (subscriber, domainId) => {
    if (watchers.has(domainId) === false) {
      watchers.set(domainId, new Set())
      joined.add(domainId)
    }
    watchers.get(domainId).add(subscriber)

    if (buffers.has(domainId) === false) buffers.set(domainId, { visits: [], idleSince: null })
    buffers.get(domainId).idleSince = null
  }

  const unwatch = (subscriber, domainId) => {
    const subscribers = watchers.get(domainId)
    subscribers.delete(subscriber)

    if (subscribers.size > 0) return

    watchers.delete(domainId)
    buffers.get(domainId).idleSince = now()
  }

  // The first tick runs at once, so a new viewer sees the views of the window without waiting
  const start = () => {
    if (active === true || watchers.size === 0) return

    active = true
    schedule(0)
  }

  const stop = () => {
    if (watchers.size > 0 || timer == null) return

    clearTimeout(timer)
    timer = undefined
    active = false
  }

  // `since` is the Last-Event-ID of a reconnect: only newer views of the buffer are replayed
  const subscribe = (domainIds, handlers, since = 0) => {
    const subscriber = { ...handlers, domains: new Set(domainIds) }

    prune(now())
    for (const domainId of subscriber.domains) watch(subscriber, domainId)

    const backlog = [...subscriber.domains]
      .flatMap((domainId) => buffers.get(domainId).visits)
      .filter((visit) => visit.created.getTime() > since)
      .toSorted((a, b) => a.created - b.created)
      .slice(-backlogSize)

    start()

    return {
      backlog,
      // The domains changed while the stream was open: access was given or taken away
      update(next) {
        const wanted = new Set(next)

        for (const domainId of subscriber.domains) {
          if (wanted.has(domainId) === false) unwatch(subscriber, domainId)
        }
        for (const domainId of wanted) {
          if (subscriber.domains.has(domainId) === false) watch(subscriber, domainId)
        }

        subscriber.domains = wanted

        start()
        stop()
      },
      close() {
        for (const domainId of subscriber.domains) unwatch(subscriber, domainId)
        subscriber.domains = new Set()

        stop()
      },
    }
  }

  return {
    subscribe,
    stats,
    watched: () => watchers.size,
  }
}

export default createHub()
