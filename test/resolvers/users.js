import test from 'ava'
import listen from 'test-listen'
import mockedEnv from 'mocked-env'

import Membership from '../../src/models/Membership.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

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

test.serial('rejects a taken address, a short password and a non-address', async (t) => {
  await register('owner@example.com', 'sufficiently-long')

  const duplicate = await register('OWNER@example.com', 'sufficiently-long')
  t.regex(duplicate.json.errors[0].message, /already in use/i)

  const short = await register('short@example.com', 'ab12')
  t.regex(short.json.errors[0].message, /at least/i)

  const notAnEmail = await register('not-an-address', 'sufficiently-long')
  t.regex(notAnEmail.json.errors[0].message, /invalid/i)
})
