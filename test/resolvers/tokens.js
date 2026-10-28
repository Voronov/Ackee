import test from 'ava'
import { randomUUID } from 'node:crypto'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import LoginAttempt from '../../src/models/LoginAttempt.js'
import Membership from '../../src/models/Membership.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
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
  const username = 'admin'
  const password = '123456'

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
    ACKEE_USERNAME: username,
    ACKEE_PASSWORD: password,
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

// A sign-in as the browser of someone at the given address would send it
const signInFrom = (ip, username, password) =>
  api(
    base,
    {
      query: gql`
        mutation createToken($input: CreateTokenInput!) {
          createToken(input: $input) {
            success
          }
        }
      `,
      variables: { input: { username, password } },
    },
    undefined,
    { 'X-Forwarded-For': ip },
  )

test.serial('five wrong passwords lock the address for that client, not for its owner elsewhere', async (t) => {
  // From node:crypto: CodeQL reads Math.random() in an address as insecure randomness
  const email = `locked-${randomUUID()}@example.com`
  const password = 'the-right-password'
  const { user, workspace } = await users.add({ email, password })
  await users.verify(user.id)

  for (let attempt = 0; attempt < 5; attempt++) {
    const { json } = await signInFrom('203.0.113.5', email, `wrong-${attempt}`)
    t.regex(json.errors[0].message, /incorrect/i)
  }

  // Whoever guessed is locked out, even with the right password
  const guesser = await signInFrom('203.0.113.5', email, password)
  t.regex(guesser.json.errors[0].message, /too many failed sign-ins/i)

  // The owner, from somewhere else, signs in as usual
  const owner = await signInFrom('198.51.100.7', email, password)
  t.true(owner.json.data.createToken.success)

  // ...and the lock of the guesser stays
  const again = await signInFrom('203.0.113.5', email, password)
  t.regex(again.json.errors[0].message, /too many failed sign-ins/i)

  await Promise.all([
    User.deleteOne({ id: user.id }),
    Membership.deleteMany({ userId: user.id }),
    Workspace.deleteOne({ id: workspace.id }),
    LoginAttempt.deleteMany({}),
  ])
})
