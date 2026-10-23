import crypto from 'node:crypto'
import http from 'node:http'

import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import { syncAll, syncConnection } from '../../src/ga4/sync.js'
import AuditLog from '../../src/models/AuditLog.js'
import Domain from '../../src/models/Domain.js'
import Ga4Connection from '../../src/models/Ga4Connection.js'
import Ga4Daily from '../../src/models/Ga4Daily.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// The service account of the tests, with a key pair made here
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'ackee-reader@datum-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
})

/*
 * A stand-in for Google: the token endpoint checks the signed JWT like Google does, the Data API
 * answers with fixed numbers for every day asked for, and refuses one property.
 */
const google = { requests: [] }
const DAY = { views: 10, users: 4, sessions: 5, seconds: 60 }
const LISTS = {
  fullPageUrl: [
    ['datum-shop.pages.dev/', 6],
    ['datum-shop.pages.dev/cart/', 4],
  ],
  sessionSource: [
    ['google', 7],
    ['(direct)', 3],
  ],
}

const days = (startDate, endDate) => {
  const out = []
  const today = new Date().toISOString().slice(0, 10)
  const resolve = (value) => {
    if (value === 'today') return today
    if (value.endsWith('daysAgo'))
      return new Date(Date.now() - Number.parseInt(value, 10) * 864e5).toISOString().slice(0, 10)
    return value
  }
  for (
    let date = new Date(resolve(startDate));
    date <= new Date(resolve(endDate));
    date = new Date(date.getTime() + 864e5)
  ) {
    out.push(date.toISOString().slice(0, 10).replaceAll('-', ''))
  }
  return out
}

// Google's token endpoint: a token only for an assertion signed with the test key
const issueToken = (body, send) => {
  const assertion = new URLSearchParams(body).get('assertion') ?? ''
  const [header, claims, signature] = assertion.split('.')
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${claims}`),
    publicKey,
    Buffer.from(signature ?? '', 'base64url'),
  )
  const claimed = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString() || '{}')
  if (valid === false || claimed.scope !== 'https://www.googleapis.com/auth/analytics.readonly')
    return send(401, { error: 'invalid_grant' })
  return send(200, { access_token: 'token-of-the-test', expires_in: 3600 })
}

const TOKEN_PATHS = new Set(['/token'])

const fakeGoogle = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const send = (status, json) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(json))
    }

    if (TOKEN_PATHS.has(request.url)) return issueToken(body, send)

    const property = /properties\/(\d+):runReport/.exec(request.url)?.[1]
    if (request.headers.authorization !== 'Bearer token-of-the-test')
      return send(401, { error: { message: 'Unauthenticated' } })
    if (property === '222222')
      return send(403, { error: { message: 'User does not have sufficient permissions for this property.' } })

    const report = JSON.parse(body)
    google.requests.push(report)
    const [{ startDate, endDate }] = report.dateRanges
    const dimension = report.dimensions?.[1]?.name
    const rows = days(startDate, endDate).flatMap((date) => {
      if (report.dimensions == null) return [{ dimensionValues: [], metricValues: [{ value: String(DAY.views) }] }]
      if (dimension == null) {
        return [
          {
            dimensionValues: [{ value: date }],
            metricValues: [DAY.views, DAY.users, DAY.sessions, DAY.seconds].map((value) => ({ value: String(value) })),
          },
        ]
      }
      return (LISTS[dimension] ?? [['(not set)', DAY.views]]).map(([value, views]) => ({
        dimensionValues: [{ value: date }, { value }],
        metricValues: [{ value: String(views) }],
      }))
    })
    send(200, { rows, rowCount: rows.length })
  })
})

let restoreEnv

test.before(async () => {
  const url = (await listen(fakeGoogle)).replace(/\/$/, '')
  restoreEnv = mockedEnv({
    ACKEE_GA4_TOKEN_URL: `${url}/token`,
    ACKEE_GA4_API_URL: url,
    ACKEE_SECRET_KEY: 'a-secret-for-the-tests',
  })
})

test.after.always(() => {
  restoreEnv()
  fakeGoogle.close()
})

const account = async (email) => {
  const { user, workspace } = await users.add({ email, password: 'sufficiently-long' })
  const token = await Token.create({ userId: user.id })
  const domain = await Domain.create({ title: 'datum-shop.pages.dev', workspaceId: workspace.id })

  return { user, domain, call: (query, variables) => api(base, { query, variables }, token.id) }
}

const connect = (call, domainId, input) =>
  call(
    gql`
      mutation connectGa4($domainId: ID!, $input: ConnectGa4Input!) {
        connectGa4(domainId: $domainId, input: $input) {
          payload {
            propertyId
            clientEmail
          }
        }
      }
    `,
    { domainId, input },
  )

// Connects and waits for the first sync, which runs after the answer
const connected = async (email) => {
  const owner = await account(email)
  await connect(owner.call, owner.domain.id, { propertyId: '111111', key: KEY })

  for (let tries = 0; tries < 200; tries++) {
    const entry = await Ga4Connection.findOne({ domainId: owner.domain.id }).lean()
    if (entry?.lastSync != null) return owner
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('The first sync did not finish')
}

const isoDaysAgo = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)

test.serial('connecting checks the key and the property before storing anything', async (t) => {
  const { call, domain } = await account('ga4-1@example.com')
  const message = async (input) => (await connect(call, domain.id, input)).json.errors?.[0]?.message

  t.regex(await message({ propertyId: 'G-ABC123', key: KEY }), /a number/)
  t.regex(await message({ propertyId: '111111', key: '{"type":"authorized_user"}' }), /service account/)
  t.regex(await message({ propertyId: '222222', key: KEY }), /sufficient permissions.*ackee-reader@datum-test/)
  t.is(await Ga4Connection.countDocuments({ domainId: domain.id }), 0)

  const restore = mockedEnv({ ACKEE_SECRET_KEY: undefined })
  t.regex(await message({ propertyId: '111111', key: KEY }), /ACKEE_SECRET_KEY/)
  restore()
})

test.serial('a connection keeps the key sealed and syncs the history', async (t) => {
  const { domain, call, user } = await connected('ga4-2@example.com')
  const entry = await Ga4Connection.findOne({ domainId: domain.id }).lean()

  t.false(entry.privateKey.includes('PRIVATE KEY'))
  t.is(entry.firstDate, isoDaysAgo(425))
  t.is(entry.lastDate, isoDaysAgo(0))
  t.is(await Ga4Daily.countDocuments({ domainId: domain.id, dimension: 'total' }), 426)
  t.is(await AuditLog.countDocuments({ userId: user.id, action: 'domain.ga4.connect' }), 1)

  const { json } = await call(gql`
    query {
      domains {
        ga4 {
          propertyId
          clientEmail
          firstDate
          lastError
          syncing
        }
      }
    }
  `)
  t.like(json.data.domains[0].ga4, {
    propertyId: '111111',
    clientEmail: 'ackee-reader@datum-test.iam.gserviceaccount.com',
    lastError: null,
    syncing: false,
  })
})

test.serial('syncing again reads only the last days and duplicates nothing', async (t) => {
  const { domain } = await connected('ga4-3@example.com')
  const before = await Ga4Daily.countDocuments({ domainId: domain.id })
  google.requests = []

  await syncConnection(await Ga4Connection.findOne({ domainId: domain.id }))

  t.is(await Ga4Daily.countDocuments({ domainId: domain.id }), before)
  t.true(google.requests.length > 0)
  t.true(google.requests.every((request) => request.dateRanges[0].startDate >= isoDaysAgo(3)))
})

test.serial('reports read GA4 when asked, in the shape of Ackee reports', async (t) => {
  const { call } = await connected('ga4-4@example.com')
  const { json } = await call(gql`
    query {
      ga: statistics(source: GA4) {
        total: views(interval: DAILY, type: TOTAL, limit: 7) {
          count
        }
        unique: views(interval: DAILY, type: UNIQUE, limit: 7) {
          count
        }
        pages(sorting: TOP, range: LAST_7_DAYS) {
          value
          count
        }
        referrers(sorting: TOP, type: WITH_SOURCE, range: LAST_7_DAYS) {
          value
          count
        }
        durations(interval: DAILY, limit: 3) {
          count
        }
        recent: pages(sorting: RECENT) {
          value
        }
      }
      own: statistics {
        views(interval: DAILY, type: TOTAL, limit: 7) {
          count
        }
      }
      facts(source: GA4) {
        activeVisitors
        viewsToday
      }
    }
  `)
  const { ga, own, facts } = json.data

  t.deepEqual(
    ga.total.map((entry) => entry.count),
    [10, 10, 10, 10, 10, 10, 10],
  )
  t.deepEqual(
    ga.unique.map((entry) => entry.count),
    [4, 4, 4, 4, 4, 4, 4],
  )
  t.deepEqual(ga.pages[0], { value: 'https://datum-shop.pages.dev/', count: 6 * 8 })
  t.deepEqual(
    ga.referrers.map((entry) => entry.value),
    ['google', '(direct)'],
  )
  t.deepEqual(
    ga.durations.map((entry) => entry.count),
    [60_000, 60_000, 60_000],
  )
  t.deepEqual(ga.recent, [])
  t.deepEqual(
    own.views.map((entry) => entry.count),
    [0, 0, 0, 0, 0, 0, 0],
  )
  t.deepEqual(facts, { activeVisitors: 0, viewsToday: 4 })
})

test.serial('only someone who manages the domain can connect, sync or disconnect it', async (t) => {
  const { domain } = await connected('ga4-5@example.com')
  const stranger = await account('ga4-5b@example.com')

  t.regex(
    (await connect(stranger.call, domain.id, { propertyId: '111111', key: KEY })).json.errors[0].message,
    /unknown domain/i,
  )
  const { json } = await stranger.call(
    gql`
      mutation sync($id: ID!) {
        syncGa4(domainId: $id) {
          success
        }
      }
    `,
    { id: domain.id },
  )
  t.regex(json.errors[0].message, /unknown domain/i)
  const removed = await stranger.call(
    gql`
      mutation off($id: ID!) {
        disconnectGa4(domainId: $id) {
          success
        }
      }
    `,
    { id: domain.id },
  )
  t.regex(removed.json.errors[0].message, /unknown domain/i)
  t.is(await Ga4Connection.countDocuments({ domainId: domain.id }), 1)
})

// Review of #37: a cached token of someone else's service account must not vouch for a forged key
test.serial('connecting with the address of a service account needs its key, not just a token', async (t) => {
  const victim = await connected('ga4-cache@example.com')
  const attacker = await account('ga4-cache-b@example.com')
  const forged = JSON.stringify({
    ...JSON.parse(KEY),
    private_key: crypto
      .generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' }),
  })

  const { json } = await connect(attacker.call, attacker.domain.id, { propertyId: '111111', key: forged })

  t.regex(json.errors[0].message, /refused/i)
  t.is(await Ga4Connection.countDocuments({ domainId: attacker.domain.id }), 0)
  t.is(await Ga4Daily.countDocuments({ domainId: attacker.domain.id }), 0)
  t.is(await Ga4Connection.countDocuments({ domainId: victim.domain.id }), 1)
})

test.serial('deleting a domain forgets its Google Analytics connection and days', async (t) => {
  const { call, domain } = await connected('ga4-delete@example.com')
  t.true((await Ga4Daily.countDocuments({ domainId: domain.id })) > 0)

  const { json } = await call(
    gql`
      mutation deleteDomain($id: ID!) {
        deleteDomain(id: $id) {
          success
        }
      }
    `,
    { id: domain.id },
  )

  t.true(json.data.deleteDomain.success)
  t.is(await Ga4Connection.countDocuments({ domainId: domain.id }), 0)
  t.is(await Ga4Daily.countDocuments({ domainId: domain.id }), 0)
})

test.serial('disconnecting forgets the property and its days', async (t) => {
  const { call, domain } = await connected('ga4-6@example.com')

  const { json } = await call(
    gql`
      mutation off($id: ID!) {
        disconnectGa4(domainId: $id) {
          success
        }
      }
    `,
    { id: domain.id },
  )

  t.true(json.data.disconnectGa4.success)
  t.is(await Ga4Connection.countDocuments({ domainId: domain.id }), 0)
  t.is(await Ga4Daily.countDocuments({ domainId: domain.id }), 0)
})

test.serial('the synced days hold numbers only, nothing about a person', async (t) => {
  const { domain } = await connected('ga4-7@example.com')
  const fields = new Set((await Ga4Daily.find({ domainId: domain.id }).lean()).flatMap((entry) => Object.keys(entry)))

  t.deepEqual([...fields].toSorted(), [
    '__v',
    '_id',
    'date',
    'dimension',
    'domainId',
    'durationSum',
    'sessions',
    'users',
    'value',
    'views',
  ])
})

test.serial('a failed sync keeps the reason for the domain dialog', async (t) => {
  const { domain } = await connected('ga4-8@example.com')
  await Ga4Connection.updateOne({ domainId: domain.id }, { $set: { propertyId: '222222' } })

  await t.throwsAsync(syncConnection(await Ga4Connection.findOne({ domainId: domain.id })))
  t.regex((await Ga4Connection.findOne({ domainId: domain.id }).lean()).lastError, /sufficient permissions/)
})

test.serial('the owner can sync now, and the next run goes on past a broken property', async (t) => {
  const healthy = await connected('ga4-9@example.com')
  const broken = await connected('ga4-9b@example.com')
  await Ga4Connection.updateOne({ domainId: broken.domain.id }, { $set: { propertyId: '222222', lastError: null } })

  const { json } = await healthy.call(
    gql`
      mutation sync($id: ID!) {
        syncGa4(domainId: $id) {
          payload {
            lastDate
            lastError
          }
        }
      }
    `,
    { id: healthy.domain.id },
  )
  t.like(json.data.syncGa4.payload, { lastDate: isoDaysAgo(0), lastError: null })

  const failed = await broken.call(
    gql`
      mutation sync($id: ID!) {
        syncGa4(domainId: $id) {
          success
        }
      }
    `,
    { id: broken.domain.id },
  )
  t.regex(failed.json.errors[0].message, /sync failed.*sufficient permissions/i)

  await syncAll()
  t.regex((await Ga4Connection.findOne({ domainId: broken.domain.id }).lean()).lastError, /sufficient permissions/)
  t.is((await Ga4Connection.findOne({ domainId: healthy.domain.id }).lean()).lastError, null)
})

test.serial('syncing a domain without a connection says so', async (t) => {
  const { call, domain } = await account('ga4-10@example.com')
  const { json } = await call(
    gql`
      mutation sync($id: ID!) {
        syncGa4(domainId: $id) {
          success
        }
      }
    `,
    { id: domain.id },
  )

  t.regex(json.errors[0].message, /not connected/i)
})
