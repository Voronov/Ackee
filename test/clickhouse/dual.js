import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import listen from 'test-listen'

import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import Action from '../../src/models/Action.js'
import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { flush } from '../../src/stores/clickhouse/writer.js'
import * as dual from '../../src/stores/dual/index.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from '../resolvers/_utils.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const restore = mockedEnv({ ACKEE_EVENT_STORE: 'dual', ACKEE_CLICKHOUSE_DATABASE: database })

const base = listen(server)

const anonymizedFields = [
  'siteLanguage',
  'screenWidth',
  'screenHeight',
  'screenColorDepth',
  'deviceName',
  'deviceManufacturer',
  'osName',
  'osVersion',
  'browserName',
  'browserVersion',
  'browserWidth',
  'browserHeight',
]

const query = async (sql, parameters) => {
  const result = await getClient().query({
    query: sql,
    query_params: { database, ...parameters },
    format: 'JSONEachRow',
  })
  return result.json()
}

const countRecords = async (domainId, final = true) => {
  const [row] = await query(
    `SELECT count() AS count FROM {database:Identifier}.records ${final === true ? 'FINAL' : ''} WHERE domainId = {domainId:String}`,
    { domainId },
  )
  return Number(row.count)
}

const readRecord = async (id) => {
  const [row] = await query(
    `
      SELECT
        id,
        clientId,
        siteLocation,
        siteReferrer,
        ${anonymizedFields.join(',\n        ')},
        toString(toUnixTimestamp64Milli(created)) AS created,
        toString(toUnixTimestamp64Milli(updated)) AS updated
      FROM {database:Identifier}.records FINAL
      WHERE id = {id:String}
    `,
    { id },
  )
  return row
}

const readAction = async (id) => {
  const [row] = await query(
    `
      SELECT id, key, value, details, toString(toUnixTimestamp64Milli(updated)) AS updated
      FROM {database:Identifier}.actions FINAL
      WHERE id = {id:String}
    `,
    { id },
  )
  return row
}

const pendingMutations = async () => {
  const [row] = await query(
    'SELECT count() AS count FROM system.mutations WHERE database = {database:String} AND is_done = 0',
    {},
  )
  return Number(row.count)
}

// ALTER TABLE DELETE runs in the background; bounded wait on the actual condition
const waitForMutations = async () => {
  for (let elapsed = 0; elapsed <= 10_000; elapsed += 100) {
    if ((await pendingMutations()) === 0) return
    await sleep(100)
  }

  throw new Error('ClickHouse mutations did not finish in time')
}

// The visitor's address decides the clientId, so distinct addresses keep every
// record's fields and a shared one triggers anonymization
const clientHeaders = (ip) => ({ 'X-Forwarded-For': ip, 'User-Agent': 'ackee-test' })

const visitorIp = (index) => `10.0.${Math.floor(index / 256)}.${index % 256}`

const createRecord = async (t, domainId, input, ip) => {
  const body = {
    query: gql`
      mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
        createRecord(domainId: $domainId, input: $input) {
          success
          payload {
            id
          }
        }
      }
    `,
    variables: { domainId, input },
  }

  const { json } = await api(base, body, undefined, clientHeaders(ip))

  t.is(json.errors, undefined)
  t.true(json.data.createRecord.success)

  return json.data.createRecord.payload
}

const updateRecord = async (t, id) => {
  const body = {
    query: gql`
      mutation updateRecord($id: ID!) {
        updateRecord(id: $id) {
          success
        }
      }
    `,
    variables: { id },
  }

  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.errors, undefined)
  t.true(json.data.updateRecord.success)
}

const createAction = async (t, eventId, input) => {
  const body = {
    query: gql`
      mutation createAction($eventId: ID!, $input: CreateActionInput!) {
        createAction(eventId: $eventId, input: $input) {
          success
          payload {
            id
          }
        }
      }
    `,
    variables: { eventId, input },
  }

  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.errors, undefined)
  t.true(json.data.createAction.success)

  return json.data.createAction.payload
}

const updateAction = async (t, id, input) => {
  const body = {
    query: gql`
      mutation updateAction($id: ID!, $input: UpdateActionInput!) {
        updateAction(id: $id, input: $input) {
          success
        }
      }
    `,
    variables: { id, input },
  }

  const { json } = await api(base, body, undefined, clientHeaders('10.1.1.1'))

  t.is(json.errors, undefined)
  t.true(json.data.updateAction.success)
}

const deleteDomain = async (t, id) => {
  const body = {
    query: gql`
      mutation deleteDomain($id: ID!) {
        deleteDomain(id: $id) {
          success
        }
      }
    `,
    variables: { id },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.is(json.errors, undefined)
  t.true(json.data.deleteDomain.success)
}

const deleteEvent = async (t, id) => {
  const body = {
    query: gql`
      mutation deleteEvent($id: ID!) {
        deleteEvent(id: $id) {
          success
        }
      }
    `,
    variables: { id },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.is(json.errors, undefined)
  t.true(json.data.deleteEvent.success)
}

const recordInput = (index) => ({
  siteLocation: `https://example.com/page-${index}`,
  siteReferrer: index % 2 === 0 ? 'https://google.com/' : undefined,
  siteLanguage: 'en',
  screenWidth: 1920,
  screenHeight: 1080,
  screenColorDepth: 24,
  deviceName: 'iPhone',
  deviceManufacturer: 'Apple',
  osName: 'iOS',
  osVersion: '17.0',
  browserName: index % 3 === 0 ? 'Safari' : 'Firefox',
  browserVersion: '18.0',
  browserWidth: 1400,
  browserHeight: 900,
})

const pickRandom = (items, count) => items.toSorted(() => Math.random() - 0.5).slice(0, count)

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

// A token is resolved to a real viewer, so the fixture builds the whole chain rather
// than inventing ids: user, personal workspace, then the domain and event inside it.
test.beforeEach(async (t) => {
  const { user, workspace } = await users.add({
    email: `user-${uuid()}@example.com`,
    password: 'example-password',
    verified: true,
    workspaceTitle: 'Example workspace',
  })

  t.context.token = await Token.create({ userId: user.id })
  t.context.domain = await Domain.create({ title: 'Example', workspaceId: workspace.id })
  t.context.event = await Event.create({ title: 'Example', type: 'TOTAL_CHART', workspaceId: workspace.id })
})

test.serial('mirrors every created record into ClickHouse with the same fields', async (t) => {
  const domainId = t.context.domain.id
  const created = []

  for (let batch = 0; batch < 10; batch++) {
    const entries = await Promise.all(
      Array.from({ length: 50 }, (_, offset) => {
        const index = batch * 50 + offset
        return createRecord(t, domainId, recordInput(index), visitorIp(index))
      }),
    )
    created.push(...entries)
  }

  await flush()

  t.is(created.length, 500)
  t.is(await Record.countDocuments({ domainId }), 500)
  t.is(await countRecords(domainId), 500)

  for (const { id } of pickRandom(created, 20)) {
    const mongoRecord = await Record.findOne({ id }).lean()
    const clickhouseRecord = await readRecord(id)

    t.is(clickhouseRecord.id, mongoRecord.id)
    t.is(clickhouseRecord.clientId, mongoRecord.clientId)
    t.is(clickhouseRecord.siteLocation, mongoRecord.siteLocation)
    t.is(clickhouseRecord.siteReferrer, mongoRecord.siteReferrer ?? null)
    t.is(clickhouseRecord.browserName, mongoRecord.browserName)
    t.is(clickhouseRecord.siteLanguage, mongoRecord.siteLanguage)
    t.is(clickhouseRecord.screenWidth, mongoRecord.screenWidth)
    t.is(clickhouseRecord.created, String(mongoRecord.created.getTime()))
    t.is(clickhouseRecord.updated, String(mongoRecord.updated.getTime()))
  }
})

test.serial('replaces the record with a version carrying the new updated date on updateRecord', async (t) => {
  const { id } = await createRecord(t, t.context.domain.id, recordInput(0), visitorIp(0))

  // Make sure the touch lands on a later millisecond than the creation
  await sleep(5)
  await updateRecord(t, id)
  await flush()

  const mongoRecord = await Record.findOne({ id }).lean()
  const rows = await query(
    `
      SELECT id, browserName, toString(toUnixTimestamp64Milli(created)) AS created, toString(toUnixTimestamp64Milli(updated)) AS updated
      FROM {database:Identifier}.records FINAL
      WHERE id = {id:String}
    `,
    { id },
  )

  t.true(mongoRecord.updated.getTime() > mongoRecord.created.getTime())
  t.deepEqual(rows, [
    {
      id,
      browserName: 'Safari',
      created: String(mongoRecord.created.getTime()),
      updated: String(mongoRecord.updated.getTime()),
    },
  ])
})

test.serial('anonymizes the earlier records of the same visitor exactly like MongoDB', async (t) => {
  const domainId = t.context.domain.id
  const ip = '10.2.2.2'

  const first = await createRecord(t, domainId, recordInput(0), ip)
  const second = await createRecord(t, domainId, recordInput(3), ip)

  await flush()

  const mongoFirst = await Record.findOne({ id: first.id }).lean()
  const mongoSecond = await Record.findOne({ id: second.id }).lean()
  const clickhouseFirst = await readRecord(first.id)
  const clickhouseSecond = await readRecord(second.id)

  t.is(mongoFirst.clientId, null)
  t.is(clickhouseFirst.clientId, '')
  t.is(clickhouseFirst.siteLocation, mongoFirst.siteLocation)
  t.is(clickhouseFirst.updated, String(mongoFirst.updated.getTime()))

  for (const field of anonymizedFields) {
    t.is(mongoFirst[field], null, field)
    t.is(clickhouseFirst[field], null, field)
  }

  t.is(typeof mongoSecond.clientId, 'string')
  t.is(clickhouseSecond.clientId, mongoSecond.clientId)

  for (const field of anonymizedFields) {
    t.not(mongoSecond[field], null, field)
    t.is(clickhouseSecond[field], mongoSecond[field], field)
  }

  t.is(await countRecords(domainId), 2)
})

// Runs the callback after the next Record.find has read its documents but before the
// caller continues, which is the only moment a concurrent write can slip between the
// read and the update of dual.anonymize
const afterNextFind = async (callback, run) => {
  const originalFind = Record.find

  Record.find = function (...args) {
    Record.find = originalFind

    const query = originalFind.apply(this, args)
    const exec = query.exec.bind(query)

    query.exec = async () => {
      const result = await exec()
      await callback()
      return result
    }

    return query
  }

  try {
    return await run()
  } finally {
    Record.find = originalFind
  }
}

test.serial('nulls in MongoDB only the records it mirrored into ClickHouse', async (t) => {
  const domainId = t.context.domain.id
  const ip = '10.3.3.3'

  const first = await createRecord(t, domainId, recordInput(0), ip)
  await flush()

  const { clientId } = await Record.findOne({ id: first.id }).lean()

  let late

  await afterNextFind(
    async () => {
      late = await Record.create({ clientId, domainId, ...recordInput(1) })
    },
    () => dual.anonymize(clientId, uuid()),
  )
  await flush()

  const mongoFirst = await Record.findOne({ id: first.id }).lean()
  const mongoLate = await Record.findOne({ id: late.id }).lean()
  const clickhouseFirst = await readRecord(first.id)

  t.is(mongoFirst.clientId, null)
  t.is(clickhouseFirst.clientId, '')
  t.is(mongoLate.clientId, clientId)
  t.is(await readRecord(late.id), undefined)

  for (const field of anonymizedFields) {
    t.is(mongoFirst[field], null, field)
    t.is(clickhouseFirst[field], null, field)
    t.is(mongoLate[field], recordInput(1)[field], field)
  }

  const third = await createRecord(t, domainId, recordInput(2), ip)
  await flush()

  const mongoLateAfter = await Record.findOne({ id: late.id }).lean()
  const clickhouseLate = await readRecord(late.id)
  const clickhouseThird = await readRecord(third.id)

  t.is(mongoLateAfter.clientId, null)
  t.is(clickhouseLate.clientId, '')
  t.is(clickhouseLate.siteLocation, mongoLateAfter.siteLocation)
  t.is(clickhouseThird.clientId, clientId)

  for (const field of anonymizedFields) {
    t.is(mongoLateAfter[field], null, field)
    t.is(clickhouseLate[field], null, field)
  }

  t.is(await Record.countDocuments({ domainId }), 3)
  t.is(await countRecords(domainId), 3)
})

test.serial('removes the records of a deleted domain from ClickHouse', async (t) => {
  const domainId = t.context.domain.id

  await Promise.all(
    Array.from({ length: 5 }, (_, index) => createRecord(t, domainId, recordInput(index), visitorIp(index))),
  )
  await flush()

  t.is(await countRecords(domainId, false), 5)

  await deleteDomain(t, domainId)
  await waitForMutations()

  t.is(await Record.countDocuments({ domainId }), 0)
  t.is(await countRecords(domainId, false), 0)
})

test.serial('mirrors created and updated actions and removes them with their event', async (t) => {
  const eventId = t.context.event.id

  const { id } = await createAction(t, eventId, { key: 'Plan', value: 1, details: 'Pro' })
  await sleep(5)
  await updateAction(t, id, { key: 'Plan', value: 2, details: 'Enterprise' })
  await flush()

  const mongoAction = await Action.findOne({ id }).lean()

  t.deepEqual(await readAction(id), {
    id,
    key: 'Plan',
    value: 2,
    details: 'Enterprise',
    updated: String(mongoAction.updated.getTime()),
  })

  await deleteEvent(t, eventId)
  await waitForMutations()

  t.is(await Action.countDocuments({ eventId }), 0)
  t.deepEqual(
    await query('SELECT id FROM {database:Identifier}.actions WHERE eventId = {eventId:String}', { eventId }),
    [],
  )
})
