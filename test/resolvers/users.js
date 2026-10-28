import test from 'ava'
import listen from 'test-listen'
import mockedEnv from 'mocked-env'

import * as users from '../../src/database/users.js'
import Membership from '../../src/models/Membership.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
import server from '../../src/server.js'
import signale from '../../src/utils/signale.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// Emails go to the log in development mode, so a test can read what was sent
const logged = []
const info = signale.info

test.before(() => {
  signale.info = (message) => logged.push(String(message))
})

test.after.always(() => {
  signale.info = info
})

// No shared fixture here: these tests are about registration itself, so they manage the
// database state themselves.
// Registration open, emails to the log instead of a mail server.
let restoreEnv

test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Workspace.deleteMany({}), Membership.deleteMany({})])
  restoreEnv = mockedEnv({ ACKEE_ALLOW_SIGNUP: 'true', NODE_ENV: 'development' })
})

test.afterEach.always(() => restoreEnv())

const register = (email, password) =>
  api(base, {
    query: gql`
      mutation createUser($input: CreateUserInput!) {
        createUser(input: $input) {
          success
          payload {
            id
            email
            verified
          }
        }
      }
    `,
    variables: { input: { email, password } },
  })

test.serial('registering creates an account and its personal workspace', async (t) => {
  const { json } = await register('someone@example.com', 'sufficiently-long')

  t.true(json.data.createUser.success)
  t.is(json.data.createUser.payload.email, 'someone@example.com')

  // A workspace is created with the account: domains belong to a workspace, so without
  // one a new user would have nowhere to put a domain.
  const memberships = await Membership.find({ userId: json.data.createUser.payload.id }).lean()

  t.is(memberships.length, 1)
  t.is(memberships[0].role, 'OWNER')
})

test.serial('every registered user is equal to every other', async (t) => {
  const first = await register('first@example.com', 'sufficiently-long')
  const second = await register('second@example.com', 'sufficiently-long')

  t.true(first.json.data.createUser.success)
  t.true(second.json.data.createUser.success)

  // Each gets their own workspace and nothing more: no rights over the instance and none
  // over anyone else's data.
  const workspaces = await Workspace.countDocuments()
  t.is(workspaces, 2)
})

const signupAllowed = async () => {
  const { json } = await api(base, {
    query: gql`
      query {
        signup {
          allowed
        }
      }
    `,
  })

  return json.data.signup.allowed
}

test.serial('registration is closed unless switched on', async (t) => {
  t.true(await signupAllowed())

  const restore = mockedEnv({ ACKEE_ALLOW_SIGNUP: undefined })

  t.false(await signupAllowed())

  const attempt = await register('someone@example.com', 'sufficiently-long')
  t.regex(attempt.json.errors[0].message, /closed/i)

  restore()
})

test.serial('registration needs outgoing email outside development', async (t) => {
  const restore = mockedEnv({ NODE_ENV: 'production', ACKEE_SMTP_HOST: undefined })

  const { json } = await register('someone@example.com', 'sufficiently-long')

  restore()

  t.regex(json.errors[0].message, /needs outgoing email/i)
  t.is(await User.countDocuments(), 0)
})

test.serial('rejects a short password, a non-address and an address too long for mail', async (t) => {
  const short = await register('short@example.com', 'ab12')
  t.regex(short.json.errors[0].message, /at least/i)

  const notAnEmail = await register('not-an-address', 'sufficiently-long')
  t.regex(notAnEmail.json.errors[0].message, /invalid/i)

  // RFC 5321 allows 64 characters before the @
  const tooLong = await register(`${'a'.repeat(65)}@example.com`, 'sufficiently-long')
  t.regex(tooLong.json.errors[0].message, /invalid/i)

  t.is(await User.countDocuments(), 0)
})

test.serial('a taken address answers like a new one, and the owner is told by email instead', async (t) => {
  const first = await register('owner@example.com', 'sufficiently-long')
  const owner = first.json.data.createUser.payload
  const stored = await User.findOne({ id: owner.id }).lean()

  logged.length = 0
  const again = await register('OWNER@example.com', 'another-long-password')

  // The same answer as for a new address, so the form does not tell who has an account
  t.is(again.json.errors, undefined)
  t.true(again.json.data.createUser.success)
  t.is(again.json.data.createUser.payload.email, 'owner@example.com')
  t.false(again.json.data.createUser.payload.verified)
  t.not(again.json.data.createUser.payload.id, owner.id)

  // Nothing was created or changed
  t.is(await User.countDocuments(), 1)
  t.is(await Workspace.countDocuments(), 1)
  t.deepEqual(await User.findOne({ id: owner.id }).lean(), stored)

  // While the address is unconfirmed, the owner gets the confirmation link again
  t.regex(logged.join('\n'), /verify\?token=/)
  t.notRegex(logged.join('\n'), /already have an Ackee account/)

  // Once confirmed, a note that the account exists
  await users.verify(owner.id)
  logged.length = 0
  const confirmed = await register('owner@example.com', 'another-long-password')

  t.true(confirmed.json.data.createUser.success)
  t.false(confirmed.json.data.createUser.payload.verified)
  t.regex(logged.join('\n'), /already have an Ackee account/)
  t.notRegex(logged.join('\n'), /verify\?token=/)

  // At most three notes an hour, like the other emails
  await register('owner@example.com', 'another-long-password')
  await register('owner@example.com', 'another-long-password')
  logged.length = 0
  const fourth = await register('owner@example.com', 'another-long-password')

  t.true(fourth.json.data.createUser.success)
  t.is(logged.length, 0)
})
