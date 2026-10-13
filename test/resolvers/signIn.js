import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import { LOGIN_ATTEMPTS } from '../../src/constants/login.js'
import * as users from '../../src/database/users.js'
import LoginAttempt from '../../src/models/LoginAttempt.js'
import Membership from '../../src/models/Membership.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
import server from '../../src/server.js'
import { day } from '../../src/utils/times.js'
import resolveViewer from '../../src/utils/viewer.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Workspace.deleteMany({}),
    Membership.deleteMany({}),
    LoginAttempt.deleteMany({}),
  ])
})

const PASSWORD = 'sufficiently-long'

const signIn = async (username, password) => {
  const { json } = await api(base, {
    query: gql`
      mutation createToken($input: CreateTokenInput!) {
        createToken(input: $input) {
          payload {
            id
          }
        }
      }
    `,
    variables: { input: { username, password } },
  })

  return { token: json.data?.createToken.payload.id, error: json.errors?.[0]?.message }
}

const confirmedAccount = async (email = 'user@example.com') => {
  const { user } = await users.add({ email, password: PASSWORD })
  await users.verify(user.id)

  return user
}

test.serial('a confirmed account signs in and the token belongs to it', async (t) => {
  const user = await confirmedAccount()

  const { token, error } = await signIn('User@Example.com', PASSWORD)

  t.is(error, undefined)
  t.is((await resolveViewer(`Bearer ${token}`, day)).userId, user.id)
})

test.serial('an unconfirmed account cannot sign in', async (t) => {
  await users.add({ email: 'new@example.com', password: PASSWORD })

  t.regex((await signIn('new@example.com', PASSWORD)).error, /confirm your email/i)
})

test.serial('a wrong password and an unknown address get the same answer', async (t) => {
  await confirmedAccount()

  const wrong = await signIn('user@example.com', 'not-the-password')
  const unknown = await signIn('nobody@example.com', PASSWORD)

  t.is(wrong.error, 'Username or password incorrect')
  t.is(unknown.error, wrong.error)
})

test.serial('the password is stored as a scrypt hash, never as given', async (t) => {
  await confirmedAccount()

  const stored = await User.findOne({ email: 'user@example.com' }).lean()

  t.not(stored.password, PASSWORD)
  t.true(stored.password.startsWith('scrypt$'))
})

test.serial('too many wrong passwords lock the address for a while', async (t) => {
  await confirmedAccount()

  for (let index = 0; index < LOGIN_ATTEMPTS; index++) await signIn('user@example.com', 'not-the-password')

  // Even the right password waits now.
  t.regex((await signIn('user@example.com', PASSWORD)).error, /too many/i)

  // Other addresses are not affected.
  await confirmedAccount('other@example.com')
  t.is((await signIn('other@example.com', PASSWORD)).error, undefined)
})

test.serial('a successful sign-in starts the count over', async (t) => {
  await confirmedAccount()

  for (let index = 0; index < LOGIN_ATTEMPTS - 1; index++) await signIn('user@example.com', 'not-the-password')
  t.is((await signIn('user@example.com', PASSWORD)).error, undefined)

  t.is(await LoginAttempt.countDocuments(), 0)
})

test.serial('the env admin keeps signing in, also when created before confirmation existed', async (t) => {
  // An admin stored by an earlier version has no `verified` field at all.
  await User.collection.insertOne({ id: 'old-admin', email: 'admin@example.com', schemaVersion: 1 })
  const restore = mockedEnv({ ACKEE_USERNAME: 'admin@example.com', ACKEE_PASSWORD: 'admin-password' })

  const { error } = await signIn('admin@example.com', 'admin-password')
  const wrong = await signIn('admin@example.com', 'not-the-password')

  restore()

  t.is(error, undefined)
  t.is(wrong.error, 'Username or password incorrect')
})
