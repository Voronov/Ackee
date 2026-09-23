import test from 'ava'
import listen from 'test-listen'

import Record from '../src/models/Record.js'
import server from '../src/server.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from './resolvers/_utils.js'

const base = listen(server)

// Reads the stream until it has collected `count` messages or the time runs out. A read
// on a quiet feed does not return, so each one is raced against the remaining time; a
// test must not wait for the next heartbeat to find out that nothing came.
const collect = async (response, count, timeout = 8000) => {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const messages = []
  const deadline = Date.now() + timeout

  let buffer = ''
  let timer = null

  const readOrGiveUp = () =>
    Promise.race([
      reader.read(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ done: true }), Math.max(deadline - Date.now(), 0))
      }),
    ]).finally(() => clearTimeout(timer))

  while (messages.length < count && Date.now() < deadline) {
    const { value, done } = await readOrGiveUp()

    if (done === true) break

    buffer += value

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const lines = block.split('\n')
      const event = lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim()
      const data = lines
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim()

      if (event != null && data != null) messages.push({ event, data: JSON.parse(data) })
    }
  }

  await reader.cancel()

  return messages
}

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('stream a visit as it is written', async (t) => {
  const url = new URL(`/live/${t.context.domain.id}`, await base)

  const response = await fetch(url.href, {
    headers: { Authorization: `Bearer ${t.context.token.id}` },
  })

  t.is(response.status, 200)
  t.true(response.headers.get('content-type').startsWith('text/event-stream'))

  // The record is written after the stream is open, so it is new to the feed. The cursor
  // starts at the moment of subscribing, which is why the 14 fixture records stay out.
  const collecting = collect(response, 2)

  await new Promise((resolve) => setTimeout(resolve, 300))

  await Record.create({
    clientId: 'live-client',
    domainId: t.context.domain.id,
    siteLocation: 'https://example.com/live',
    siteReferrer: 'https://news.example.org/story',
    country: 'UA',
    browserName: 'Firefox',
    osName: 'Linux',
    created: new Date(),
    updated: new Date(),
  })

  const messages = await collecting

  t.is(messages[0].event, 'open')
  t.is(messages[0].data.domainId, t.context.domain.id)

  t.is(messages[1].event, 'visit')
  t.is(messages[1].data.siteLocation, 'https://example.com/live')
  t.is(messages[1].data.country, 'UA')
  t.is(messages[1].data.browserName, 'Firefox')

  // The feed carries what the card shows and nothing else.
  t.false('clientId' in messages[1].data)
})

test.serial('the feed starts at the moment of subscribing', async (t) => {
  const url = new URL(`/live/${t.context.domain.id}`, await base)

  const response = await fetch(url.href, {
    headers: { Authorization: `Bearer ${t.context.token.id}` },
  })

  // The fixture holds 14 records written before this. None of them is a live visit.
  const messages = await collect(response, 2, 3000)

  t.is(messages.length, 1)
  t.is(messages[0].event, 'open')
})

test.serial('a record dated in the future does not silence the feed', async (t) => {
  const url = new URL(`/live/${t.context.domain.id}`, await base)

  const response = await fetch(url.href, {
    headers: { Authorization: `Bearer ${t.context.token.id}` },
  })

  const collecting = collect(response, 2, 6000)

  await new Promise((resolve) => setTimeout(resolve, 300))

  // The Google Analytics importer writes records dated to the end of the day it imports,
  // so a record ahead of the clock is something a normal instance really holds.
  await Record.create({
    clientId: 'tomorrow',
    domainId: t.context.domain.id,
    siteLocation: 'https://example.com/imported',
    created: new Date(Date.now() + 6 * 60 * 60 * 1000),
    updated: new Date(),
  })

  await Record.create({
    clientId: 'now',
    domainId: t.context.domain.id,
    siteLocation: 'https://example.com/real',
    created: new Date(),
    updated: new Date(),
  })

  const messages = await collecting

  t.is(messages[0].event, 'open')

  // The visit that happened is sent; the one dated six hours from now waits its turn.
  t.is(messages.length, 2)
  t.is(messages[1].data.siteLocation, 'https://example.com/real')
})

test.serial('reject a request without a token', async (t) => {
  const url = new URL(`/live/${t.context.domain.id}`, await base)
  const response = await fetch(url.href)

  t.is(response.status, 401)
})

test.serial('a domain of another workspace does not exist', async (t) => {
  const url = new URL('/live/00000000-0000-4000-8000-000000000000', await base)

  const response = await fetch(url.href, {
    headers: { Authorization: `Bearer ${t.context.token.id}` },
  })

  t.is(response.status, 404)
})
