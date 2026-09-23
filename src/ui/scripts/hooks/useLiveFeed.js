import { useEffect, useRef, useState } from 'react'

import { get as getToken } from './useToken.js'

/*
 * Reads the live feed of a domain.
 *
 * The browser has EventSource for this, but it cannot send an Authorization header, and
 * the feed is behind the same bearer token as everything else. So the stream is read with
 * fetch and the few lines of the server-sent events format are parsed here.
 */

const MAX_ITEMS = 25
const RETRY_DELAY = 5000

// A message is a block of `field: value` lines, and blocks are separated by a blank line.
// A line starting with a colon is a comment, which is how the server keeps the connection
// from being closed by a proxy.
const parseMessage = (block) => {
  const lines = block.split('\n').filter((line) => line.startsWith(':') === false)
  const event = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim()
  const data = lines
    .find((line) => line.startsWith('data:'))
    ?.slice(5)
    .trim()

  if (event == null || data == null) return

  try {
    return { event, data: JSON.parse(data) }
  } catch {
    // A half-written message is not worth reporting: the next one will be whole.
  }
}

export default (domainId, enabled = true) => {
  const [items, setItems] = useState([])
  const [connected, setConnected] = useState(false)

  // Survives a re-render, so a reconnect that is already scheduled is not scheduled twice.
  const retry = useRef(null)

  useEffect(() => {
    if (enabled === false || domainId == null) return

    const controller = new AbortController()
    let stopped = false

    const read = async () => {
      try {
        const response = await fetch(`/live/${domainId}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          signal: controller.signal,
        })

        if (response.ok === false) throw new Error(`Live feed refused with status ${response.status}`)

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''

        while (stopped === false) {
          const { value, done } = await reader.read()

          if (done === true) break

          buffer += value

          // Everything up to the last blank line is whole; the rest waits for more bytes.
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() ?? ''

          for (const block of blocks) {
            const message = parseMessage(block)

            if (message == null) continue
            if (message.event === 'open') setConnected(true)
            if (message.event === 'visit') {
              setItems((current) => [message.data, ...current].slice(0, MAX_ITEMS))
            }
          }
        }
      } catch {
        // A dropped connection is normal: a laptop closes, a proxy times out.
      }

      if (stopped === true) return

      setConnected(false)
      retry.current = setTimeout(read, RETRY_DELAY)
    }

    read()

    return () => {
      stopped = true
      controller.abort()
      clearTimeout(retry.current)
    }
  }, [domainId, enabled])

  return { items, connected }
}
