// Line endings of Server-Sent Events: CRLF, LF or a lone CR
const LINE_BREAK = /\r\n|\r|\n/

/*
 * Reads a Server-Sent Events stream and calls `onEvent({ type, data, id })` for every event,
 * following https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation.
 *
 * The UI needs this because EventSource cannot send the Authorization header, so the live
 * feed is read with fetch() (ADR-007). `retry:` is not handled: the caller has its own backoff.
 * Resolves when the stream ends and rejects when it fails or is aborted.
 */
export default async (stream, onEvent) => {
  const reader = stream.getReader()
  // Removes a byte order mark at the start, as the spec asks
  const decoder = new TextDecoder()

  let pending = ''
  let type = ''
  let data = ''
  let id = ''

  const dispatch = () => {
    // An event without data only moves the id, the spec drops it
    if (data === '') {
      type = ''
      return
    }

    onEvent({ type: type === '' ? 'message' : type, data: data.slice(0, -1), id })

    type = ''
    data = ''
  }

  const handleLine = (line) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return

    const index = line.indexOf(':')
    const field = index === -1 ? line : line.slice(0, index)
    const raw = index === -1 ? '' : line.slice(index + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw

    if (field === 'event') type = value
    if (field === 'data') data += `${value}\n`
    if (field === 'id' && value.includes('\0') === false) id = value
  }

  const feed = (text, done) => {
    let buffer = pending + text
    let held = ''

    // A CR at the end of a chunk may be the first half of a CRLF. Splitting on it now would
    // read the LF of the next chunk as an empty line and dispatch too early.
    if (done === false && buffer.endsWith('\r')) {
      held = '\r'
      buffer = buffer.slice(0, -1)
    }

    const lines = buffer.split(LINE_BREAK)
    pending = lines.pop() + held

    for (const line of lines) handleLine(line)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done === true) {
        // What is left is an event without its closing empty line, which the spec discards
        feed(decoder.decode(), true)
        return
      }

      feed(decoder.decode(value, { stream: true }), false)
    }
  } catch (error) {
    // When `onEvent` throws, the stream is still open: cancel it, so the connection is freed
    reader.cancel().catch(() => {})
    throw error
  }
}
