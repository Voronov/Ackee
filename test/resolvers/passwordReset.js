import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

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

// Emails go to the log, where the tests read the link from.
let restoreEnv

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Workspace.deleteMany({}),
    Membership.deleteMany({}),
    UserToken.deleteMany({}),
  ])
  restoreEnv = mockedEnv({ NODE_ENV: 'development' })
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

const account = async () => {
  const created = await users.add({ email: 'someone@example.com', password: 'sufficiently-long' })
  await users.verify(created.user.id)

  return created
}

const requestReset = (email) =>
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

const resetPassword = (token, password) =>
  api(base, {
    query: gql`
      mutation resetPassword($input: ResetPasswordInput!) {
        resetPassword(input: $input) {
          success
        }
      }
    `,
    variables: { input: { token, password } },
  })

const signIn = async (username, password) => {
  const { json } = await api(base, {
    query: gql`
      mutation createToken($input: CreateTokenInput!) {
        createToken(input: $input) {
          success
        }
      }
    `,
    variables: { input: { username, password } },
  })

  return json.errors?.[0]?.message ?? 'OK'
}

test.serial('request a link, follow it, sign in with the new password', async (t) => {
  await account()
  const emails = captureEmails()

  t.true((await requestReset('someone@example.com')).json.data.requestPasswordReset.success)

  emails.restore()

  const token = emails.logged.join('\n').match(/reset\?token=([\w-]+)/)?.[1]
  t.truthy(token)

  t.true((await resetPassword(token, 'a-brand-new-password')).json.data.resetPassword.success)

  t.is(await signIn('someone@example.com', 'a-brand-new-password'), 'OK')
  t.is(await signIn('someone@example.com', 'sufficiently-long'), 'Username or password incorrect')
})

test.serial('a reset link works once', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'RESET')

  t.true((await resetPassword(token, 'a-brand-new-password')).json.data.resetPassword.success)
  t.regex((await resetPassword(token, 'another-new-password')).json.errors[0].message, /already been used/i)
})

test.serial('an expired reset link is refused', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'RESET')

  await UserToken.updateOne({ userId: user.id }, { $set: { expires: new Date(Date.now() - 1000) } })

  t.regex((await resetPassword(token, 'a-brand-new-password')).json.errors[0].message, /expired/i)
})

test.serial('a confirmation link cannot reset a password', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'VERIFY')

  t.regex((await resetPassword(token, 'a-brand-new-password')).json.errors[0].message, /not valid/i)
})

test.serial('the new password follows the same policy', async (t) => {
  const { user } = await account()
  const token = await userTokens.issue(user.id, 'RESET')

  t.regex((await resetPassword(token, 'short')).json.errors[0].message, /at least/i)
})

test.serial('a reset request never reveals whether the address exists', async (t) => {
  await account()
  const emails = captureEmails()

  const known = await requestReset('someone@example.com')
  const unknown = await requestReset('nobody@example.com')

  emails.restore()

  t.true(known.json.data.requestPasswordReset.success)
  t.true(unknown.json.data.requestPasswordReset.success)

  // Only the real address gets a link, but the answer is the same either way.
  t.is(emails.logged.length, 1)
})

test.serial('reset requests are limited to three links an hour', async (t) => {
  const { user } = await account()
  const emails = captureEmails()

  for (let attempt = 0; attempt < 5; attempt++) await requestReset('someone@example.com')

  emails.restore()

  t.is(emails.logged.length, 3)
  t.is(await UserToken.countDocuments({ userId: user.id, purpose: 'RESET' }), 3)
})
