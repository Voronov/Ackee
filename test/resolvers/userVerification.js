import test from 'ava'
import listen from 'test-listen'
import mockedEnv from 'mocked-env'

import * as userTokens from '../../src/database/userTokens.js'
import * as users from '../../src/database/users.js'
import Membership from '../../src/models/Membership.js'
import User from '../../src/models/User.js'
import UserToken from '../../src/models/UserToken.js'
import Workspace from '../../src/models/Workspace.js'
import server from '../../src/server.js'
import signale from '../../src/utils/signale.js'
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
    UserToken.deleteMany({}),
  ])
})

// Registration open, emails to the log, where the tests read the link from.
let restoreEnv

test.beforeEach(() => {
  restoreEnv = mockedEnv({ ACKEE_ALLOW_SIGNUP: 'true', NODE_ENV: 'development' })
})

test.afterEach.always(() => restoreEnv())

const captureEmails = () => {
  const info = signale.info
  const logged = []
  signale.info = (message) => logged.push(String(message))

  return {
    logged,
    restore: () => {
      signale.info = info
    },
  }
}

const account = () => users.add({ email: 'someone@example.com', password: 'sufficiently-long' })

const verify = (token) =>
  api(base, {
    query: gql`
      mutation verifyUser($token: String!) {
        verifyUser(token: $token) {
          success
        }
      }
    `,
    variables: { token },
  })

const signIn = (username, password) =>
  api(base, {
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

test.serial('register, follow the link from the email, then sign in', async (t) => {
  const emails = captureEmails()

  const { json } = await api(base, {
    query: gql`
      mutation createUser($input: CreateUserInput!) {
        createUser(input: $input) {
          payload {
            verified
          }
        }
      }
    `,
    variables: { input: { email: 'new@example.com', password: 'sufficiently-long' } },
  })

  emails.restore()

  t.false(json.data.createUser.payload.verified)

  const before = await signIn('new@example.com', 'sufficiently-long')
  t.regex(before.json.errors[0].message, /confirm your email/i)

  const token = emails.logged.join('\n').match(/verify\?token=([\w-]+)/)?.[1]
  t.truthy(token)

  const confirmed = await verify(token)
  t.true(confirmed.json.data.verifyUser.success)

  const after = await signIn('new@example.com', 'sufficiently-long')
  t.is(after.json.errors, undefined)
  t.is(typeof after.json.data.createToken.payload.id, 'string')
})

test.serial('a link confirms the address once and only once', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'VERIFY')

  const first = await verify(token)
  t.true(first.json.data.verifyUser.success)

  const stored = await User.findOne({ id: user.id }).lean()
  t.true(stored.verified)

  // Following the same link again says so plainly, rather than pretending it is unknown.
  const second = await verify(token)
  t.regex(second.json.errors[0].message, /already been used/i)
})

test.serial('an expired link is refused', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'VERIFY')

  await UserToken.updateOne({ userId: user.id }, { $set: { expires: new Date(Date.now() - 1000) } })

  const { json } = await verify(token)
  t.regex(json.errors[0].message, /expired/i)
})

test.serial('an unknown link is refused', async (t) => {
  const { json } = await verify('not-a-real-token')
  t.regex(json.errors[0].message, /not valid/i)
})

const resend = (email) =>
  api(base, {
    query: gql`
      mutation resendVerification($email: String!) {
        resendVerification(email: $email) {
          success
        }
      }
    `,
    variables: { email },
  })

test.serial('a new confirmation link replaces the old one, at most three an hour', async (t) => {
  const { user } = await account()
  const old = await userTokens.issue(user.id, 'VERIFY')
  const emails = captureEmails()

  for (let index = 0; index < 4; index++)
    t.true((await resend('someone@example.com')).json.data.resendVerification.success)

  emails.restore()

  // One link was issued above, so only two more fit into the hour.
  t.is(emails.logged.length, 2)
  t.regex((await verify(old)).json.errors[0].message, /already been used/i)
})

test.serial('asking for a link never tells whether an address has an account', async (t) => {
  const emails = captureEmails()

  const { json } = await resend('nobody@example.com')

  emails.restore()

  t.true(json.data.resendVerification.success)
  t.is(emails.logged.length, 0)
})

test.serial('the viewer query returns the signed-in account', async (t) => {
  const { user } = await account()
  await users.verify(user.id)
  const signedIn = await signIn('someone@example.com', 'sufficiently-long')

  const { json } = await api(
    base,
    {
      query: gql`
        query {
          viewer {
            email
            verified
          }
        }
      `,
    },
    signedIn.json.data.createToken.payload.id,
  )

  t.deepEqual(json.data.viewer, { email: 'someone@example.com', verified: true })
})
