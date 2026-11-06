import test from 'ava'
import { startOfDay } from 'date-fns'
import listen from 'test-listen'

import * as records from '../../src/database/records.js'
import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { day, hour, second } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

let validRecord
let ignoredRecord

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('create record', async (t) => {
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
    variables: {
      domainId: t.context.domain.id,
      input: {
        siteLocation: 'https://example.com/',
        siteReferrer: 'https://google.com/',
      },
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.true(json.data.createRecord.success)
  t.is(typeof json.data.createRecord.payload.id, 'string')

  // Save record for the next test
  validRecord = json.data.createRecord.payload
})

test.serial('update record', async (t) => {
  const body = {
    query: gql`
      mutation updateRecord($id: ID!) {
        updateRecord(id: $id) {
          success
        }
      }
    `,
    variables: {
      id: validRecord.id,
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.true(json.data.updateRecord.success)
})

const touch = (id) => ({
  query: gql`
    mutation updateRecord($id: ID!) {
      updateRecord(id: $id) {
        success
      }
    }
  `,
  variables: { id },
})

test.serial('a late update of a record from a sealed hour changes nothing and is no error', async (t) => {
  const created = new Date(Date.now() - 2 * day)
  const updated = new Date(created.getTime() + 10 * second)
  const entry = await Record.create({
    domainId: t.context.domain.id,
    siteLocation: 'https://example.com/',
    created,
    updated,
  })

  const { json } = await api(base, touch(entry.id))

  t.true(json.data.updateRecord.success)
  t.deepEqual((await Record.findOne({ id: entry.id })).updated, updated)
})

test.serial('a record of a day that is not sealed yet grows past the limit of durations', async (t) => {
  // Fixed times keep the test away from midnight, when the seal moves
  const created = new Date(startOfDay(Date.now()).getTime() - 3 * day + 10 * hour)
  const entry = await Record.create({
    domainId: t.context.domain.id,
    siteLocation: 'https://example.com/',
    created,
    updated: created,
  })

  // A tab that stays open in the background keeps going, and its visit stops counting as before
  const sameDay = new Date(created.getTime() + 2 * hour)
  t.deepEqual((await records.update(entry.id, sameDay)).updated, sameDay)

  // The next day the hour is sealed, so a touch no longer moves the record
  const nextDay = new Date(created.getTime() + day)
  t.deepEqual((await records.update(entry.id, nextDay)).updated, sameDay)
})

test.serial('an update of an unknown record is still an error', async (t) => {
  const { json } = await api(base, touch('00000000-0000-4000-8000-000000000000'))

  t.is(json.errors[0].message, 'Unknown record')
})

test.serial('ignore record creation when logged in', async (t) => {
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
    variables: {
      domainId: t.context.domain.id,
      input: { siteLocation: 'https://example.com/' },
    },
  }

  const { json } = await api(base, body, t.context.token.id, {
    Cookie: 'ackee_ignore=1',
  })

  t.true(json.data.createRecord.success)
  t.is(json.data.createRecord.payload.id, '88888888-8888-8888-8888-888888888888')

  // Save record for the next test
  ignoredRecord = json.data.createRecord.payload
})

test.serial('ignore record update when logged in', async (t) => {
  const body = {
    query: gql`
      mutation updateRecord($id: ID!) {
        updateRecord(id: $id) {
          success
        }
      }
    `,
    variables: {
      id: ignoredRecord.id,
    },
  }

  const { json } = await api(base, body, t.context.token.id, {
    Cookie: 'ackee_ignore=1',
  })

  t.true(json.data.updateRecord.success)
})

test.serial('reject record with invalid siteLocation', async (t) => {
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
    variables: {
      domainId: t.context.domain.id,
      input: {
        siteLocation: 'test.com.1.2.3',
      },
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.is(json.data, undefined)
  t.truthy(json.errors)
  t.is(json.errors.length, 1)
  t.true(json.errors[0].message.includes('Invalid URL'))
})

test.serial('reject record with invalid siteReferrer', async (t) => {
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
    variables: {
      domainId: t.context.domain.id,
      input: {
        siteLocation: 'https://example.com/',
        siteReferrer: 'not-a-valid-url',
      },
    },
  }

  const { json } = await api(base, body, t.context.token.id)

  t.is(json.data, undefined)
  t.truthy(json.errors)
  t.is(json.errors.length, 1)
  t.true(json.errors[0].message.includes('Invalid URL'))
})
