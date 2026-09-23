import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import { close } from '../../src/clickhouse/client.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { flush, stats } from '../../src/stores/clickhouse/writer.js'
import signale from '../../src/utils/signale.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from '../resolvers/_utils.js'

// Nothing listens on port 1, so every insert is refused immediately. The env is not
// restored: the rows kept for the next attempt retry on the timer after the test and
// must not reach the real ClickHouse of the npm script
mockedEnv({ ACKEE_EVENT_STORE: 'dual', ACKEE_CLICKHOUSE_URL: 'http://localhost:1' })

const base = listen(server)

// Not restored either, so that retry does not print into the test output
const errors = []

signale.error = (message) => errors.push(message)

test.before(connectToDatabase)

test.after.always(async () => {
  await close()
  await cleanup(server)()
})

test('stores the record in MongoDB and answers the tracker when ClickHouse is unreachable', async (t) => {
  const domain = await Domain.create({ title: 'Example' })

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
      domainId: domain.id,
      input: { siteLocation: 'https://example.com/' },
    },
  }

  const { json } = await api(base, body)

  t.is(json.errors, undefined)
  t.true(json.data.createRecord.success)

  const { id } = json.data.createRecord.payload
  const record = await Record.findOne({ id }).lean()

  t.is(record.siteLocation, 'https://example.com')

  await flush()

  t.is(stats.errors, 1)
  t.deepEqual(errors, [
    'ClickHouse Connection: Insert: HTTP request error. (ECONNREFUSED)',
    'ClickHouse Connection: Insert: HTTP request error. (ECONNREFUSED)',
    'ClickHouse insert of 1 rows into records failed twice: ECONNREFUSED',
  ])
})
