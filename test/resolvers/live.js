import test from 'ava'
import mongoose from 'mongoose'
import { setTimeout as sleep } from 'node:timers/promises'
import listen from 'test-listen'

import { anonymize } from '../../src/database/records.js'
import * as users from '../../src/database/users.js'
import hub from '../../src/live/hub.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import User from '../../src/models/User.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { openStream } from '../live/_stream.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// Two unrelated accounts, as in isolation.js: can one of them watch the other's visitors?
const tenant = async (name) => {
  const { user, workspace } = await users.add({
    email: `${name}-live@example.com`,
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: name,
  })

  const domain = await Domain.create({ title: `${name}.example.com`, workspaceId: workspace.id })
  const token = await Token.create({ userId: user.id })

  return { user, workspace, domain, token }
}

let alice
let mallory

test.before(async () => {
  alice = await tenant('alice')
  mallory = await tenant('mallory')
})

const detailed = {
  siteLocation: 'https://alice.example.com/pricing',
  siteReferrer: 'https://news.example.org/',
  source: 'Newsletter',
  siteLanguage: 'en',
  screenWidth: 1920,
  screenHeight: 1080,
  screenColorDepth: 24,
  deviceName: 'iPhone',
  deviceManufacturer: 'Apple',
  osName: 'iOS',
  osVersion: '18.0',
  browserName: 'Safari',
  browserVersion: '18.0',
  browserWidth: 1200,
  browserHeight: 800,
}

const createRecord = (domainId, input, userAgent = `visitor-${Math.random()}`) =>
  api(
    base,
    {
      query: gql`
        mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
          createRecord(domainId: $domainId, input: $input) {
            payload {
              id
            }
          }
        }
      `,
      variables: { domainId, input },
    },
    undefined,
    { 'User-Agent': userAgent },
  )

const visitOf = (stream, siteLocation) =>
  stream.waitFor((entry) => entry.event === 'visit' && entry.data.siteLocation === siteLocation)

test.serial('a view reaches the stream within 10 s with the agreed fields only', async (t) => {
  const stream = await openStream(base, { token: alice.token.id, domainId: alice.domain.id })
  t.teardown(stream.close)

  const started = Date.now()
  const { json } = await createRecord(alice.domain.id, detailed)
  const { id } = json.data.createRecord.payload

  const entry = await visitOf(stream, detailed.siteLocation)
  t.true(Date.now() - started <= 10_000)

  t.deepEqual(Object.keys(entry.data).toSorted(), [
    'browserName',
    'created',
    'deviceManufacturer',
    'deviceName',
    'domainId',
    'key',
    'osName',
    'siteLanguage',
    'siteLocation',
    'siteReferrer',
    'source',
  ])
  t.like(entry.data, {
    domainId: alice.domain.id,
    // Normalized on the way in, as in the reports
    siteReferrer: 'https://news.example.org',
    source: 'Newsletter',
    browserName: 'Safari',
    osName: 'iOS',
  })

  // The id of the record never leaves the server, and the key cannot stand in for it
  t.not(entry.data.key, id)
  t.false(JSON.stringify(entry).includes(id))
  t.is(entry.id, String(new Date(entry.data.created).getTime()))

  const { json: touched } = await api(base, {
    query: gql`
      mutation updateRecord($id: ID!) {
        updateRecord(id: $id) {
          success
        }
      }
    `,
    variables: { id: entry.data.key },
  })
  t.is(touched.errors[0].message, 'Unknown record')
})

test.serial('a view without personal data comes without its fields', async (t) => {
  const stream = await openStream(base, { token: alice.token.id, domainId: alice.domain.id })
  t.teardown(stream.close)

  await createRecord(alice.domain.id, { siteLocation: 'https://alice.example.com/plain' })

  const entry = await visitOf(stream, 'https://alice.example.com/plain')
  t.like(entry.data, {
    siteReferrer: null,
    source: null,
    siteLanguage: null,
    browserName: null,
    osName: null,
    deviceManufacturer: null,
    deviceName: null,
  })
})

test.serial('a view anonymized before the feed read it comes without its personal fields', async (t) => {
  // A domain of its own, so no buffer holds the view from before it was anonymized
  const domain = await Domain.create({ title: 'anonymized.example.com', workspaceId: alice.workspace.id })
  t.teardown(() => Domain.deleteOne({ id: domain.id }))

  await Record.create({
    ...detailed,
    clientId: 'returning-visitor',
    domainId: domain.id,
    siteLocation: 'https://alice.example.com/earlier',
    created: new Date(),
  })
  // The next view of the same visitor forgets the personal data of the previous ones
  await anonymize('returning-visitor', 'the-next-view')

  const stream = await openStream(base, { token: alice.token.id, domainId: domain.id })
  t.teardown(stream.close)

  const entry = await visitOf(stream, 'https://alice.example.com/earlier')
  t.like(entry.data, {
    siteReferrer: 'https://news.example.org/',
    source: 'Newsletter',
    siteLanguage: null,
    browserName: null,
    osName: null,
    deviceManufacturer: null,
    deviceName: null,
  })
})

test.serial("one account never sees the visitors of another's domains", async (t) => {
  const watcher = await openStream(base, { token: alice.token.id })
  t.teardown(watcher.close)
  const owner = await openStream(base, { token: mallory.token.id })
  t.teardown(owner.close)

  await createRecord(mallory.domain.id, { siteLocation: 'https://mallory.example.com/secret' })
  await createRecord(alice.domain.id, { siteLocation: 'https://alice.example.com/own' })

  t.truthy(await visitOf(owner, 'https://mallory.example.com/secret'))
  t.truthy(await visitOf(watcher, 'https://alice.example.com/own'))
  t.false(watcher.visits().some((entry) => entry.domainId === mallory.domain.id))
})

test.serial("another workspace's domain is as unknown as one that does not exist", async (t) => {
  const foreign = await openStream(base, { token: alice.token.id, domainId: mallory.domain.id })
  const missing = await openStream(base, { token: alice.token.id, domainId: 'f0000000-0000-4000-8000-000000000000' })

  t.is(foreign.status, 404)
  t.is(missing.status, 404)
  t.is(foreign.text, 'Unknown domain')
  t.is(foreign.text, missing.text)
})

test.serial('a stream needs a token, in the header and nowhere else', async (t) => {
  const without = await openStream(base)
  const invalid = await openStream(base, { token: 'not-a-token' })
  // A token in the URL would end up in logs, so it does not count
  const inQuery = await openStream(base, { query: { token: alice.token.id } })

  for (const refused of [without, invalid, inQuery]) {
    t.is(refused.status, 401)
    t.is(refused.headers.get('www-authenticate'), 'Bearer')
  }
})

test.serial('a stream needs the permission to read reports', async (t) => {
  const user = await User.create({ email: `nobody-${Math.random()}@example.com`, verified: true })
  // A role nobody defined grants nothing (ADR-003)
  await Membership.create({ userId: user.id, workspaceId: alice.workspace.id, role: 'NOBODY' })
  const token = await Token.create({ userId: user.id })

  const refused = await openStream(base, { token: token.id })

  t.is(refused.status, 403)
})

test.serial('ten viewers cost one query per tick', async (t) => {
  const client = mongoose.connection.getClient()
  let finds = 0
  const count = (event) => {
    if (event.commandName === 'find' && event.command.find === 'records') finds += 1
  }

  const streams = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      openStream(base, { token: alice.token.id, ...(index % 2 === 0 ? { domainId: alice.domain.id } : {}) }),
    ),
  )
  t.teardown(() => Promise.all(streams.map((stream) => stream.close())))

  const ticks = () => Object.values(hub.stats.polls).reduce((sum, value) => sum + value, 0)
  // A tick counts once its query is done, so the count starts and ends right after one
  const nextTick = async () => {
    const start = ticks()
    while (ticks() === start) await sleep(10)
  }

  await nextTick()
  const before = ticks()
  client.on('commandStarted', count)
  t.teardown(() => client.off('commandStarted', count))

  await sleep(5000)
  await nextTick()

  const polled = ticks() - before
  // Two seconds apart, and every one of them reads the views of all ten streams at once
  t.true(polled >= 2)
  t.true(polled <= 5)
  t.is(finds, polled)
})

test.serial('a view of a stream counts in the metrics without naming a domain', async (t) => {
  process.env.ACKEE_METRICS_TOKEN = 'live-secret'
  t.teardown(() => delete process.env.ACKEE_METRICS_TOKEN)

  const stream = await openStream(base, { token: alice.token.id })
  t.teardown(stream.close)
  await createRecord(alice.domain.id, { siteLocation: 'https://alice.example.com/metrics' })
  await visitOf(stream, 'https://alice.example.com/metrics')

  const response = await fetch(new URL('/metrics', await base), { headers: { Authorization: 'Bearer live-secret' } })
  const text = await response.text()

  t.regex(text, /^ackee_live_connections{app="ackee"} [1-9]/m)
  t.regex(text, /^ackee_live_visits_sent_total{app="ackee"} [1-9]/m)
  t.false(text.includes(alice.domain.id))
  t.false(text.includes(alice.workspace.id))
  // A stream is not a request with a duration
  t.false(text.includes('route="/api/live"'))
  t.is(await Record.countDocuments({ siteLocation: 'https://alice.example.com/metrics' }), 1)
})
