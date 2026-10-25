import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

const touch = (id, token, headers) =>
  api(
    base,
    {
      query: gql`
        mutation updateRecord($id: ID!) {
          updateRecord(id: $id) {
            success
          }
        }
      `,
      variables: { id },
    },
    token,
    headers,
  )

test.serial('updateRecord refuses an address that sent more touches than the limit in a minute', async (t) => {
  const restore = mockedEnv({ ACKEE_UPDATE_RECORD_LIMIT: '2' })
  t.teardown(restore)

  const id = '00000000-0000-4000-8000-000000000000'
  const first = await touch(id, t.context.token.id)
  const second = await touch(id, t.context.token.id)
  const third = await touch(id, t.context.token.id)

  // Unknown record is the answer within the limit, the limit itself only comes after it
  t.is(first.json.errors[0].message, 'Unknown record')
  t.is(second.json.errors[0].message, 'Unknown record')
  t.is(third.json.errors[0].message, 'Too many requests')
})

test.serial('updateRecord does not count touches of the own visits', async (t) => {
  const restore = mockedEnv({ ACKEE_UPDATE_RECORD_LIMIT: '1' })
  t.teardown(restore)

  const id = '00000000-0000-4000-8000-000000000000'

  for (let index = 0; index < 3; index++) {
    const { json } = await touch(id, t.context.token.id, { Cookie: 'ackee_ignore=1' })
    t.true(json.data.updateRecord.success)
  }
})
