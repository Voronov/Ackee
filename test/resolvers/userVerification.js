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

// A host that cannot be reached is enough: sending fails and is logged, but the flow
// around it still runs, which is what these tests are about.
const withMail = () => mockedEnv({ ACKEE_SMTP_HOST: 'smtp.invalid', ACKEE_SMTP_PORT: '465' })

const account = () =>
  users.add({ email: 'someone@example.com', password: 'sufficiently-long', workspaceTitle: 'Personal' })

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

test.serial('with mail configured an account starts unconfirmed', async (t) => {
  const restore = withMail()

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

  t.false(json.data.createUser.payload.verified)

  restore()
})

test.serial('without mail an account is usable straight away', async (t) => {
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

  // Nobody could confirm an address on an instance with no outgoing mail, so requiring
  // it would leave the account unusable forever.
  t.true(json.data.createUser.payload.verified)
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

test.serial('a reset request never reveals whether the address exists', async (t) => {
  const restore = withMail()
  await account()

  const request = (email) =>
    api(base, {
      query: gql`
        mutation requestPasswordReset($email: String!) {
          requestPasswordReset(email: $email) {
            success
          }
        }
      `,
      variables: { email },
    })

  const known = await request('someone@example.com')
  const unknown = await request('nobody@example.com')

  t.true(known.json.data.requestPasswordReset.success)
  t.true(unknown.json.data.requestPasswordReset.success)

  // Only the real address gets a link, but the answer is the same either way.
  t.is(await UserToken.countDocuments({ purpose: 'RESET' }), 1)

  restore()
})

test.serial('a reset sets the new password and confirms the address', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'RESET')

  const { json } = await api(base, {
    query: gql`
      mutation resetPassword($input: ResetPasswordInput!) {
        resetPassword(input: $input) {
          success
        }
      }
    `,
    variables: { input: { token, password: 'a-brand-new-password' } },
  })

  t.true(json.data.resetPassword.success)

  const signIn = await api(base, {
    query: gql`
      mutation createToken($input: CreateTokenInput!) {
        createToken(input: $input) {
          success
        }
      }
    `,
    variables: { input: { username: 'someone@example.com', password: 'a-brand-new-password' } },
  })

  t.true(signIn.json.data.createToken.success)
})

test.serial('sending is rate limited', async (t) => {
  const restore = withMail()
  const { user } = await account()

  const request = () =>
    api(base, {
      query: gql`
        mutation requestPasswordReset($email: String!) {
          requestPasswordReset(email: $email) {
            success
          }
        }
      `,
      variables: { email: 'someone@example.com' },
    })

  for (let attempt = 0; attempt < 5; attempt++) await request()

  // Five requests, at most three links. An earlier version deleted superseded links, which
  // reset the counter every time and left the limit doing nothing.
  const issued = await UserToken.countDocuments({ userId: user.id, purpose: 'RESET' })
  t.is(issued, 3)

  restore()
})
