import test from 'ava'
import listen from 'test-listen'

import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { ready as geoReady } from '../../src/utils/geo.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

const create = async (t, forwardedFor) => {
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
      input: { siteLocation: 'https://example.com/geo' },
    },
  }

  const { json } = await api(base, body, t.context.token.id, { 'X-Forwarded-For': forwardedFor })

  t.true(json.data.createRecord.success)

  return Record.findOne({ id: json.data.createRecord.payload.id }).lean()
}

// Regression: the country was resolved in the resolver, but database/records.js lists
// the fields to write explicitly and `country` was not among them, so the value vanished
// on the way. Resolver tests missed it because the fixture inserts records directly.
test.serial('the country reaches the database', async (t) => {
  process.env.ACKEE_GEO = 'true'
  await geoReady()

  const record = await create(t, '8.8.8.8')

  t.is(record.country, 'US')
})

test.serial('no country is written while the flag is off', async (t) => {
  delete process.env.ACKEE_GEO

  const record = await create(t, '8.8.8.8')

  t.is(record.country, undefined)
})

test.serial('an address with no country still accepts the event', async (t) => {
  process.env.ACKEE_GEO = 'true'
  await geoReady()

  const record = await create(t, '127.0.0.1')

  t.is(record.country, undefined)

  delete process.env.ACKEE_GEO
})
