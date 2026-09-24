import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'
import listen from 'test-listen'

import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import { INTERVALS_DAILY } from '../../src/constants/intervals.js'
import { RANGES_LAST_30_DAYS } from '../../src/constants/ranges.js'
import { SORTINGS_TOP } from '../../src/constants/sortings.js'
import { VIEWS_TYPE_TOTAL } from '../../src/constants/views.js'
import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { flush } from '../../src/stores/clickhouse/writer.js'
import * as dual from '../../src/stores/dual/index.js'
import { getEventStore } from '../../src/stores/index.js'
import * as mongo from '../../src/stores/mongo/index.js'
import createDate from '../../src/utils/createDate.js'
import { cleanup, connectToDatabase, gql } from '../resolvers/_utils.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

// Reads come from ClickHouse, so a download that still went to MongoDB would show
const restore = mockedEnv({ ACKEE_EVENT_STORE: 'clickhouse', ACKEE_CLICKHOUSE_DATABASE: database })

const base = listen(server)

// A page only MongoDB knows about, so a report answered by the wrong store is visible
const mongoOnlyLocation = 'https://example.com/mongo-only/'
const sharedLocation = 'https://example.com/shared/'

const download = async (path, token) => {
  const url = new URL(path, await base)

  const result = await fetch(url.href, {
    headers: { 'Authorization': `Bearer ${token}`, 'Time-Zone': 'UTC' },
  })

  return { status: result.status, text: await result.text() }
}

/*
 * The same trimming `src/export.js` applies to a row: the recursive id means nothing
 * outside a running instance, and an undefined field would become a column that only
 * some sortings ever fill. Dates are compared as the strings JSON turns them into.
 */
const forExport = (entry) =>
  Object.fromEntries(
    Object.entries(entry)
      .filter(([key, value]) => key !== 'id' && value !== undefined)
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  )

const dateDetails = () => createDate('UTC')

test.before(async () => {
  await connectToDatabase()
  await ensureSchema(database)
})

test.after.always(async () => {
  await getClient().command({ query: 'DROP DATABASE IF EXISTS {database:Identifier}', query_params: { database } })
  await close()
  await cleanup(server)()
  restore()
})

// A token is resolved to a real viewer, so the fixture builds the whole chain: user,
// personal workspace, then the domain inside it.
test.beforeEach(async (t) => {
  const { user, workspace } = await users.add({
    email: `user-${uuid()}@example.com`,
    password: 'example-password',
    verified: true,
    workspaceTitle: 'Example workspace',
  })

  t.context.token = await Token.create({ userId: user.id })
  t.context.domain = await Domain.create({ title: 'Example', workspaceId: workspace.id })

  const domainId = t.context.domain.id

  // Written through the store, so both MongoDB and ClickHouse hold them
  for (let index = 0; index < 10; index++) {
    await dual.addRecord({
      clientId: `client-${index}`,
      domainId,
      siteLocation: index % 2 === 0 ? sharedLocation : `${sharedLocation}${index}`,
      siteLanguage: 'en',
    })
  }

  // Written past the store, the way history that was never migrated looks
  await Record.create({ clientId: 'client-mongo-only', domainId, siteLocation: mongoOnlyLocation })

  await flush()
})

test.afterEach.always(async (t) => {
  await Record.deleteMany({ domainId: t.context.domain.id })
})

test.serial('downloads the pages report from the event store, not from MongoDB', async (t) => {
  const domainId = t.context.domain.id
  const { status, text } = await download(`/export/${domainId}/pages.json`, t.context.token.id)
  const rows = JSON.parse(text)

  const fromStore = await getEventStore().pages([domainId], SORTINGS_TOP, RANGES_LAST_30_DAYS, 100, dateDetails())
  const fromMongo = await mongo.pages([domainId], SORTINGS_TOP, RANGES_LAST_30_DAYS, 100, dateDetails())

  t.is(status, 200)
  t.deepEqual(rows, fromStore.map(forExport))

  // The fixture is only meaningful while the two stores actually disagree
  t.true(fromMongo.some((entry) => entry.value === mongoOnlyLocation))
  t.false(rows.some((row) => row.value === mongoOnlyLocation))
  t.true(rows.some((row) => row.value === sharedLocation))
})

test.serial('downloads the views report from the event store, not from MongoDB', async (t) => {
  const domainId = t.context.domain.id
  const { status, text } = await download(`/export/${domainId}/views.json`, t.context.token.id)
  const rows = JSON.parse(text)

  const fromStore = await getEventStore().views([domainId], VIEWS_TYPE_TOTAL, INTERVALS_DAILY, 100, dateDetails())
  const fromMongo = await mongo.views([domainId], VIEWS_TYPE_TOTAL, INTERVALS_DAILY, 100, dateDetails())

  t.is(status, 200)
  t.deepEqual(rows, fromStore.map(forExport))

  // MongoDB counts the record the store never saw, so the totals must differ
  const total = (entries) => entries.reduce((sum, entry) => sum + entry.count, 0)

  t.is(total(fromStore), 10)
  t.is(total(fromMongo), 11)
})

test.serial('downloads a csv report from the event store', async (t) => {
  const domainId = t.context.domain.id
  const { status, text } = await download(`/export/${domainId}/pages.csv`, t.context.token.id)

  const [header, ...rows] = text.replace('﻿', '').trim().split('\n')

  t.is(status, 200)
  t.is(header, 'value,count')
  t.true(rows.includes(`${sharedLocation},5`))
  t.false(rows.some((row) => row.startsWith(mongoOnlyLocation)))
})

// A domain the viewer cannot reach must stay invisible no matter which store answers
test.serial('keeps the workspace check in front of the store', async (t) => {
  const foreign = await Domain.create({ title: 'Foreign', workspaceId: uuid() })
  const { status } = await download(`/export/${foreign.id}/pages.json`, t.context.token.id)

  t.is(status, 404)
})

test.serial('answers the dashboard and the download from the same store', async (t) => {
  const domainId = t.context.domain.id

  const body = {
    query: gql`
      query getPages($id: ID!) {
        domain(id: $id) {
          statistics {
            pages(sorting: TOP, range: LAST_30_DAYS, limit: 100) {
              value
              count
            }
          }
        }
      }
    `,
    variables: { id: domainId },
  }

  const url = new URL('/api', await base)

  const result = await fetch(url.href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${t.context.token.id}`,
      'Time-Zone': 'UTC',
    },
    body: JSON.stringify(body),
  })

  const json = await result.json()
  const { text } = await download(`/export/${domainId}/pages.json`, t.context.token.id)

  t.is(json.errors, undefined)
  t.deepEqual(
    JSON.parse(text).map(({ value, count }) => ({ value, count })),
    json.data.domain.statistics.pages,
  )
})
