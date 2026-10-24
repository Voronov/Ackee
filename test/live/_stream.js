import { setTimeout as sleep } from 'node:timers/promises'

// Splits a Server-Sent Events frame into its fields. A comment (`: ping`) comes as its own event.
const parse = (frame) => {
  const entry = {}

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) return { event: 'comment', data: line.slice(1).trim() }

    const index = line.indexOf(':')
    const field = line.slice(0, index)
    const value = line.slice(index + 1).trimStart()

    if (field === 'data') entry.data = JSON.parse(value)
    else entry[field] = value
  }

  return entry
}

// Opens a live stream the way the UI does: fetch() with the token in the Authorization header.
export const openStream = async (base, { token, domainId, query, headers = {} } = {}) => {
  const url = new URL('/api/live', await base)
  if (domainId != null) url.searchParams.set('domainId', domainId)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)

  const controller = new AbortController()
  const response = await fetch(url, {
    headers: { ...(token == null ? {} : { Authorization: `Bearer ${token}` }), ...headers },
    signal: controller.signal,
  })

  if (response.status !== 200) {
    return { status: response.status, headers: response.headers, text: await response.text() }
  }

  const events = []
  let ended = false

  const read = async () => {
    const decoder = new TextDecoder()
    let pending = ''

    try {
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true })

        let index
        while ((index = pending.indexOf('\n\n')) !== -1) {
          events.push(parse(pending.slice(0, index)))
          pending = pending.slice(index + 2)
        }
      }
    } catch {
      // Aborted by close()
    }

    ended = true
  }

  const done = read()

  // Resolves with the first event that matches, or with undefined after the timeout
  const waitFor = async (match, timeout = 8000) => {
    const until = Date.now() + timeout

    while (Date.now() < until) {
      const found = events.find(match)
      if (found != null) return found
      if (ended === true) return events.find(match)
      await sleep(20)
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    events,
    visits: () => events.filter((entry) => entry.event === 'visit').map((entry) => entry.data),
    waitFor,
    // Resolves once the server closed the stream
    ended: () => done.then(() => events),
    isEnded: () => ended,
    close: async () => {
      controller.abort()
      await done
    },
  }
}
