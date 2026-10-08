import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

let validToken

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('return token and cookie after successful login', async (t) => {
  const username = t.context.email
  const password = t.context.password

  const body = {
    query: gql`
      mutation createToken($input: CreateTokenInput!) {
        createToken(input: $input) {
          success
          payload {
            id
          }
        }
      }
    `,
    variables: {
      input: {
        username,
        password,
      },
    },
  }

  const restore = mockedEnv({
    ACKEE_ALLOW_ORIGIN: 'https://badexample.com,https://bad.example.com,https://example.com',
  })

  const { headers, json } = await api(base, body, undefined, {
    Host: 'ackee.example.com',
  })

  t.true(headers.get('Set-Cookie').includes('ackee_ignore=1'))
  t.true(json.data.createToken.success)
  t.is(typeof json.data.createToken.payload.id, 'string')

  // Save token for the next test
  validToken = json.data.createToken.payload

  restore()
})

test.serial('clear login cookie after successful logout', async (t) => {
  const body = {
    query: gql`
      mutation deleteToken($id: ID!) {
        deleteToken(id: $id) {
          success
        }
      }
    `,
    variables: {
      id: validToken.id,
    },
  }

  const { json, headers } = await api(base, body, undefined, {
    Host: 'ackee.example.com',
  })

  t.true(headers.get('Set-Cookie').includes('ackee_ignore=0'))
  t.true(json.data.deleteToken.success)
})
