import test from 'ava'

import readEventStream from '../../src/ui/scripts/api/live/readEventStream.js'

const streamOf = (chunks) => {
  const encoder = new TextEncoder()

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      controller.close()
    },
  })
}

const read = async (chunks) => {
  const events = []
  await readEventStream(streamOf(chunks), (event) => events.push(event))
  return events
}

test('reads the events of the live feed', async (t) => {
  const events = await read([
    'retry: 5000\n\nid: 1792790883680\nevent: visit\ndata: {"key":"a"}\n\n: ping\n\nevent: gap\ndata: {}\n\n',
  ])

  t.deepEqual(events, [
    { type: 'visit', data: '{"key":"a"}', id: '1792790883680' },
    { type: 'gap', data: '{}', id: '1792790883680' },
  ])
})

test('an event split across chunks arrives once and whole', async (t) => {
  const events = await read(['id: 1\nev', 'ent: visit\nda', 'ta: {"key"', ':"a"}\n', '\n'])

  t.deepEqual(events, [{ type: 'visit', data: '{"key":"a"}', id: '1' }])
})

test('a character split across chunks is decoded whole', async (t) => {
  const bytes = new TextEncoder().encode('data: Київ\n\n')
  const events = await read([bytes.slice(0, 8), bytes.slice(8)])

  t.is(events[0].data, 'Київ')
})

test('CRLF split between chunks does not end the event early', async (t) => {
  const events = await read(['event: visit\r', '\ndata: a\r', '\n\r\n', 'data: b\r\r'])

  t.deepEqual(events, [
    { type: 'visit', data: 'a', id: '' },
    { type: 'message', data: 'b', id: '' },
  ])
})

test('joins data lines and keeps a value without the leading space', async (t) => {
  const events = await read(['data:one\ndata:  two\ndata\n\n'])

  t.is(events[0].data, 'one\n two\n')
})

test('an event without data is not dispatched, but its id is kept', async (t) => {
  const events = await read(['id: 7\nevent: visit\n\ndata: x\n\n'])

  t.deepEqual(events, [{ type: 'message', data: 'x', id: '7' }])
})

test('an id with a NUL character is ignored', async (t) => {
  const events = await read(['id: 1\ndata: a\n\nid: 2\0\ndata: b\n\n'])

  t.deepEqual(
    events.map((event) => event.id),
    ['1', '1'],
  )
})

test('an event cut off by the end of the stream is dropped', async (t) => {
  const events = await read(['data: a\n\ndata: b\n'])

  t.deepEqual(
    events.map((event) => event.data),
    ['a'],
  )
})

test('a failing stream rejects', async (t) => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.error(new Error('gone'))
    },
  })

  await t.throwsAsync(
    readEventStream(stream, () => {}),
    { message: 'gone' },
  )
})

test('a stream is cancelled when handling an event fails', async (t) => {
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {broken\n\n'))
    },
    cancel() {
      cancelled = true
    },
  })

  await t.throwsAsync(
    readEventStream(stream, (event) => JSON.parse(event.data)),
    { instanceOf: SyntaxError },
  )
  t.true(cancelled)
})
