import express from 'express'
import signale from 'signale'

import Record from './models/Record.js'
import * as domains from './database/domains.js'
import { workspaceIds } from './utils/domainIds.js'
import resolveViewer from './utils/viewer.js'
import config from './utils/config.js'
import KnownError from './utils/KnownError.js'

/*
 * A live feed of visits.
 *
 * Version 1.0 had one live number, `activeVisitors`, and the interface asked for it every
 * five minutes. This pushes each visit as it is written instead.
 *
 * Server-sent events rather than WebSockets: the data only ever travels one way, and SSE
 * is plain HTTP, so it passes through the same reverse proxy and the same bearer token as
 * every other route.
 *
 * The visits are found by polling, not by watching the database. Ingest runs in its own
 * process, so a change made there is not an event here, and the two ways of learning
 * about it both cost something we decided against: change streams need a replica set, and
 * a message queue needs a queue. Polling `{ domainId, created }` is an index scan of a few
 * keys on the index the reports already use, and one poll serves every listener on that
 * domain rather than one per listener.
 */

const POLL_INTERVAL = 2000

// Proxies and load balancers close a connection that says nothing. A comment line is a
// valid but empty message, so it keeps the connection open without reaching the listener.
const HEARTBEAT_INTERVAL = 25_000

// A burst of traffic should not turn into a burst of messages.
const MAX_PER_POLL = 20

// One entry per domain that somebody is watching: the listeners, the timer and the point
// in time the last poll reached.
const feeds = new Map()

// Only what the feed shows. A record holds more, and a live feed is the wrong place to
// hand out more than the screen needs.
const forFeed = (record) => ({
  id: record.id,
  created: record.created,
  siteLocation: record.siteLocation,
  siteReferrer: record.siteReferrer ?? null,
  source: record.source ?? null,
  country: record.country ?? null,
  browserName: record.browserName ?? null,
  osName: record.osName ?? null,
  deviceName: record.deviceName ?? null,
  deviceManufacturer: record.deviceManufacturer ?? null,
})

const poll = async (domainId) => {
  const feed = feeds.get(domainId)

  if (feed == null) return

  // A poll that overruns the interval must not start a second one beside itself.
  if (feed.polling === true) return

  feed.polling = true

  try {
    /*
     * The upper bound is not decoration. A record can carry a date in the future: the
     * Google Analytics importer takes `created` from the date in the CSV and spreads the
     * views across that whole day, so importing today writes records dated until midnight.
     *
     * Without the bound those records are sent at once, which is wrong, and then the
     * cursor sits in the future, which is worse: every real visit until midnight is older
     * than the cursor and never reaches the feed again.
     */
    const now = new Date()

    const records = await Record.find({ domainId, created: { $gt: feed.cursor, $lte: now } })
      .sort({ created: 1 })
      .limit(MAX_PER_POLL)
      .lean()

    if (records.length > 0) {
      // Moving the cursor only over what was read means a record beyond the limit is
      // picked up by the next poll rather than skipped.
      feed.cursor = records.at(-1).created

      for (const record of records) {
        send(feed, 'visit', forFeed(record))
      }
    }
  } catch (error) {
    // A failed poll is not a reason to drop the listeners: the next one may work.
    signale.warn(`Live feed poll failed: ${error.message}`)
    send(feed, 'error', { message: 'Could not read the latest visits' })
  } finally {
    feed.polling = false
  }
}

const send = (feed, event, data) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

  for (const listener of feed.listeners) listener.write(message)
}

const subscribe = (domainId, response) => {
  if (feeds.has(domainId) === false) {
    feeds.set(domainId, {
      listeners: new Set(),
      polling: false,
      // Only what happens from now on. The reports are there for what happened before.
      cursor: new Date(),
      timer: setInterval(() => poll(domainId), POLL_INTERVAL),
    })
  }

  const feed = feeds.get(domainId)

  feed.listeners.add(response)

  return () => {
    feed.listeners.delete(response)

    // Nobody is watching, so nothing needs to be polled.
    if (feed.listeners.size === 0) {
      clearInterval(feed.timer)
      feeds.delete(domainId)
    }
  }
}

const router = express.Router()

router.get('/live/:domainId', async (request, response) => {
  // The token comes in a header like everywhere else. That rules out the browser's own
  // EventSource, which cannot send one, so the interface reads the stream with fetch. The
  // alternative was a token in the query string, where proxies and access logs keep it.
  const viewer = await resolveViewer(request.headers['authorization'], config.ttl)

  if (viewer instanceof KnownError) return response.status(401).json({ error: viewer.message })

  const domain = await domains.get(request.params.domainId, workspaceIds(viewer))

  if (domain == null) return response.status(404).json({ error: 'Unknown domain' })

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Nginx buffers a response by default, which holds every event back until the buffer
    // fills. Caddy does not, but Ackee is put behind both.
    'X-Accel-Buffering': 'no',
  })

  // The first message tells the interface the stream is open, so it can say so before
  // the first visit arrives, which may be a long wait on a quiet site.
  response.write(`retry: 5000\nevent: open\ndata: ${JSON.stringify({ domainId: domain.id })}\n\n`)

  const unsubscribe = subscribe(domain.id, response)
  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), HEARTBEAT_INTERVAL)

  request.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

export default router
