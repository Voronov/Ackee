import { useEffect, useState } from 'react'

import readEventStream from '../api/live/readEventStream.js'

export const LIVE_CONNECTING = 'connecting'
export const LIVE_OPEN = 'open'
export const LIVE_RECONNECTING = 'reconnecting'
export const LIVE_PAUSED = 'paused'
export const LIVE_STOPPED = 'stopped'

// Rows the page keeps, the newest. Matches what the server replays to a new stream at most.
const ROWS = 100

const MIN_DELAY = 1000
const MAX_DELAY = 30_000

// A stream open this long counts as working, and the next reconnect starts with the shortest
// delay again. One the server or a proxy closes at once would otherwise be opened every second.
const STABLE_AFTER = 30_000

// A hidden tab gives its stream back after this long, so it does not hold a slot of the
// workspace limit or one of the six connections a browser opens to a server without HTTP/2
const HIDDEN_TIMEOUT = 60_000

// Why the server did not open the stream or ended it, for answers that are not worth a retry
const STOP_MESSAGES = {
  403: 'You cannot read reports in any workspace, so there is nothing to show.',
  404: 'The live feed is turned off or not available on this server.',
  forbidden: 'You can no longer read reports in any workspace. The live feed stopped.',
  unknown_domain: 'The domains of this feed are gone. The live feed stopped.',
}

// Up to 2, 4, 8, 16 and then 30 seconds, never less than half of that, so tabs that lost the
// server at the same moment do not all come back at the same moment
const backoff = (attempt) => {
  const ceiling = Math.min(MAX_DELAY, MIN_DELAY * 2 ** (attempt + 1))
  return ceiling / 2 + Math.random() * (ceiling / 2)
}

const retryAfter = (response, attempt) => {
  const seconds = Number(response.headers.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + Math.random() * MIN_DELAY : backoff(attempt)
}

const add = (visits, entry) => {
  if (visits.some((visit) => visit.key === entry.key)) return visits
  // A second gap right after the first tells nothing new
  if (entry.gap === true && visits[0]?.gap === true) return visits
  return [entry, ...visits].slice(0, ROWS)
}

/*
 * The views of all readable domains as they come in, from GET /api/live (ADR-007).
 *
 * Reconnects with a growing delay and sends the id of the last event, so a reconnect
 * only replays what it missed. A 401 or an `unauthorized` end signs the user out like
 * any other authentication error.
 */
export default (token, reset) => {
  const [visits, setVisits] = useState([])
  const [state, setState] = useState({ status: LIVE_CONNECTING })

  useEffect(() => {
    let controller
    let retryTimer
    let hiddenTimer
    let attempt = 0
    let lastEventId = ''
    let gaps = 0
    let paused = false
    let stopped = false

    const disconnect = () => {
      controller?.abort()
      controller = undefined
      clearTimeout(retryTimer)
    }

    const stop = (message) => {
      stopped = true
      disconnect()
      setState({ status: LIVE_STOPPED, message })
    }

    const signOut = () => {
      stopped = true
      disconnect()
      reset()
    }

    const receive = ({ type, data, id }) => {
      lastEventId = id

      if (type === 'visit') {
        const visit = JSON.parse(data)
        setVisits((visits) => add(visits, visit))
      }
      if (type === 'gap') {
        const gap = { key: `gap:${Date.now()}:${gaps++}`, gap: true }
        setVisits((visits) => add(visits, gap))
      }
      if (type === 'end') return JSON.parse(data).reason
    }

    const read = async (body) => {
      let reason
      await readEventStream(body, (event) => {
        reason = receive(event) ?? reason
      })
      return reason
    }

    const connect = async () => {
      const current = new AbortController()
      controller = current

      let openedAt
      let delay
      let message

      try {
        const response = await fetch('/api/live', {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            ...(lastEventId === '' ? {} : { 'Last-Event-ID': lastEventId }),
          },
          cache: 'no-store',
          signal: current.signal,
        })

        if (response.status === 401) return signOut()
        if (STOP_MESSAGES[response.status] != null) return stop(STOP_MESSAGES[response.status])

        if (response.status === 429) {
          delay = retryAfter(response, attempt)
          message = `Too many live streams are open. Trying again in ${Math.round(delay / 1000)} seconds.`
        } else if (response.ok === true) {
          openedAt = Date.now()
          setState({ status: LIVE_OPEN })

          const reason = await read(response.body)
          if (reason === 'unauthorized') return signOut()
          if (reason != null) return stop(STOP_MESSAGES[reason] ?? 'The live feed stopped.')
        }
      } catch (error) {
        // Aborted on purpose: the tab is hidden or the page is gone
        if (current.signal.aborted === true) return
        // Otherwise the server is gone, the network failed or an event was broken: worth a retry
        if (error.name !== 'TypeError') console.warn(error)
        // A stream that failed on an event is still open and would hold a slot of the limits
        current.abort()
      }

      // Disconnected on purpose meanwhile
      if (controller !== current) return

      if (openedAt != null && Date.now() - openedAt > STABLE_AFTER) attempt = 0

      delay ??= backoff(attempt)
      attempt += 1

      controller = undefined
      setState({ status: LIVE_RECONNECTING, message })
      retryTimer = setTimeout(connect, delay)
    }

    const pause = () => {
      if (stopped === true) return

      paused = true
      disconnect()
      setState({ status: LIVE_PAUSED })
    }

    const onVisibilityChange = () => {
      clearTimeout(hiddenTimer)

      if (document.hidden === true) {
        hiddenTimer = setTimeout(pause, HIDDEN_TIMEOUT)
        return
      }

      if (paused === true) {
        paused = false
        attempt = 0
        setState({ status: LIVE_CONNECTING })
        connect()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.hidden === true) hiddenTimer = setTimeout(pause, HIDDEN_TIMEOUT)

    connect()

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimeout(hiddenTimer)
      disconnect()
    }
  }, [token, reset])

  return {
    visits,
    ...state,
  }
}
