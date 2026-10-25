import express from 'express'

import {
  LIVE_FORBIDDEN,
  LIVE_HEARTBEAT_INTERVAL,
  LIVE_MAX_BUFFERED,
  LIVE_MAX_PACK,
  LIVE_PATH,
  LIVE_PROCESS_LIMIT,
  LIVE_RECHECK_INTERVAL,
  LIVE_RETRY,
  LIVE_RETRY_AFTER,
  LIVE_UNAUTHORIZED,
  LIVE_UNKNOWN_DOMAIN,
  LIVE_WORKSPACE_LIMIT,
} from '../constants/live.js'
import { REPORTS_READ } from '../constants/permissions.js'
import * as domains from '../database/domains.js'
import config from '../utils/config.js'
import KnownError from '../utils/KnownError.js'
import { workspacesWith } from '../utils/permissions.js'
import signale from '../utils/signale.js'
import resolveViewer from '../utils/viewer.js'
import defaultHub from './hub.js'

// Status and text of every refusal. A domain of another workspace gets the same answer as one
// that does not exist (ADR-003).
const REFUSALS = {
  [LIVE_UNAUTHORIZED]: [401, 'Token missing or invalid'],
  [LIVE_FORBIDDEN]: [403, 'You do not have permission to do this'],
  [LIVE_UNKNOWN_DOMAIN]: [404, 'Unknown domain'],
  [LIVE_PROCESS_LIMIT]: [429, 'Too many live streams'],
  [LIVE_WORKSPACE_LIMIT]: [429, 'Too many live streams for this workspace'],
}

// The domains a stream may show and the workspaces it counts against, or why it may not open.
// Asked again while the stream is open, so taking access away ends it.
const access = async (authorization, domainId) => {
  const viewer = await resolveViewer(authorization, config.ttl)
  if (viewer instanceof KnownError) return { reason: LIVE_UNAUTHORIZED }

  const workspaceIds = workspacesWith(viewer, REPORTS_READ)
  if (workspaceIds.length === 0) return { reason: LIVE_FORBIDDEN }

  // Without a domain the stream shows all readable ones, as the overview does
  if (domainId === undefined) {
    const entries = await domains.all(workspaceIds)

    return { domainIds: entries.map((entry) => entry.id), workspaceIds }
  }

  // A repeated parameter arrives as a list
  if (typeof domainId !== 'string') return { reason: LIVE_UNKNOWN_DOMAIN }

  const entry = await domains.get(domainId, workspaceIds)
  if (entry == null) return { reason: LIVE_UNKNOWN_DOMAIN }

  return { domainIds: [entry.id], workspaceIds: [entry.workspaceId] }
}

const event = (name, data, id) => `${id == null ? '' : `id: ${id}\n`}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

/*
 * GET /api/live, a Server-Sent Events stream of views (ADR-007).
 *
 * The token comes in the Authorization header, as for the GraphQL API, and never in the URL:
 * a URL ends up in logs and in the history of the browser. That is also why the UI reads the
 * stream with fetch() instead of EventSource, which cannot send headers.
 */
export const createRouter = ({
  hub = defaultHub,
  heartbeat = LIVE_HEARTBEAT_INTERVAL,
  recheck = LIVE_RECHECK_INTERVAL,
} = {}) => {
  const router = express.Router()
  // Limits are per process: after ACKEE-19 they would need Redis, which is not required
  const occupied = new Map()
  const stats = { connections: 0, rejected: {}, sent: 0 }

  const reject = (reason) => {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1
  }

  const refuse = (response, reason) => {
    const [status, message] = REFUSALS[reason]

    reject(reason)

    if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer')
    if (status === 429) response.setHeader('Retry-After', String(LIVE_RETRY_AFTER))

    response.status(status).type('text/plain').send(message)
  }

  const isFull = (workspaceIds) => {
    if (stats.connections >= config.liveConnections) return LIVE_PROCESS_LIMIT

    const limit = config.liveWorkspaceConnections
    if (workspaceIds.some((id) => (occupied.get(id) ?? 0) >= limit)) return LIVE_WORKSPACE_LIMIT
  }

  const occupy = (workspaceIds, change) => {
    stats.connections += change

    for (const id of workspaceIds) {
      const next = (occupied.get(id) ?? 0) + change
      if (next === 0) occupied.delete(id)
      else occupied.set(id, next)
    }
  }

  router.get(LIVE_PATH, async (request, response) => {
    // 0 turns the feed off. The answer is the one of a route that does not exist.
    if (config.liveConnections === 0) return response.status(404).type('text/plain').send('Not found')

    // The client may leave while access is checked, and then no close would come any more
    let gone = false
    response.once('close', () => {
      gone = true
    })

    const { authorization } = request.headers
    const { domainId } = request.query
    const granted = await access(authorization, domainId)

    if (gone === true) return
    if (granted.reason != null) return refuse(response, granted.reason)

    // Checked and taken without an await in between, so parallel requests cannot both get the last slot
    const full = isFull(granted.workspaceIds)
    if (full != null) return refuse(response, full)

    occupy(granted.workspaceIds, 1)

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Otherwise nginx holds the events back until its buffer is full
      'X-Accel-Buffering': 'no',
    })

    // What one turn of the event loop writes is a pack: a tick of the hub, the backlog, a ping.
    // Undefined between packs.
    let packStart

    // Whether the chunk was written. A client that does not read would make the process
    // buffer for it without end, so it is dropped instead. Checked when a pack starts: a full
    // tick alone can be larger than LIVE_MAX_BUFFERED, and a client that reads must get it.
    const write = (chunk) => {
      if (response.writableEnded === true || response.destroyed === true) return false

      if (packStart === undefined) {
        packStart = response.writableLength
        queueMicrotask(() => {
          packStart = undefined
        })

        // Still behind from the last pack, so it has not read since
        if (packStart > LIVE_MAX_BUFFERED) {
          response.destroy()
          return false
        }
      }

      response.write(chunk)
      if (response.writableLength > LIVE_MAX_BUFFERED + LIVE_MAX_PACK) response.destroy()

      return true
    }

    const sendVisit = (visit) => {
      if (write(event('visit', visit, visit.created.getTime())) === true) stats.sent += 1
    }

    const lastEventId = Number(request.headers['last-event-id'])
    const subscription = hub.subscribe(
      granted.domainIds,
      { visit: sendVisit, gap: () => write(event('gap', {})) },
      Number.isFinite(lastEventId) ? lastEventId : 0,
    )

    write(`retry: ${LIVE_RETRY}\n\n`)
    for (const visit of subscription.backlog) sendVisit(visit)

    const end = (reason) => {
      reject(reason)
      write(event('end', { reason }))
      response.end()
    }

    let checking = false
    const check = async () => {
      if (checking === true) return
      checking = true

      try {
        const next = await access(authorization, domainId)

        if (response.writableEnded === true || response.destroyed === true) return
        if (next.reason != null) return end(next.reason)

        subscription.update(next.domainIds)
      } catch (error) {
        // The stream keeps the domains it had, and the next check tries again
        signale.warn(`Live feed could not check a stream: ${error.message}`)
      } finally {
        checking = false
      }
    }

    const timers = [setInterval(() => write(': ping\n\n'), heartbeat), setInterval(check, recheck)]
    for (const timer of timers) timer.unref()

    response.once('close', () => {
      for (const timer of timers) clearInterval(timer)
      subscription.close()
      occupy(granted.workspaceIds, -1)
    })
  })

  router.stats = stats

  return router
}

export default createRouter()
