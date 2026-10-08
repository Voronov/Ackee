import test from 'ava'
import listen from 'test-listen'

import * as userTokens from '../src/database/userTokens.js'
import * as users from '../src/database/users.js'
import User from '../src/models/User.js'
import server from '../src/server.js'
import { cleanup, connectToDatabase } from './resolvers/_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

const account = (email) => users.add({ email, password: 'sufficiently-long', workspaceTitle: 'Personal' })

const get = async (path) => {
  const response = await fetch(new URL(path, await base).href)

  return { status: response.status, body: await response.text() }
}

test.serial('a confirmation link confirms the address', async (t) => {
  const { user } = await account('verify-page@example.com')
  const token = await userTokens.issue(user.id, 'VERIFY')

  const { status, body } = await get(`/verify?token=${token}`)

  t.is(status, 200)
  t.regex(body, /confirmed/i)
  t.true((await User.findOne({ id: user.id }).lean()).verified)
})

test.serial('a used confirmation link says so plainly', async (t) => {
  const { user } = await account('verify-twice@example.com')
  const token = await userTokens.issue(user.id, 'VERIFY')

  await get(`/verify?token=${token}`)
  const { status, body } = await get(`/verify?token=${token}`)

  t.is(status, 400)
  t.regex(body, /already used/i)
})

test.serial('an unknown confirmation link is refused', async (t) => {
  const { status, body } = await get('/verify?token=nonsense')

  t.is(status, 400)
  t.regex(body, /not valid/i)
})

test.serial('the reset page carries the token into the form', async (t) => {
  const { user } = await account('reset-page@example.com')
  const token = await userTokens.issue(user.id, 'RESET')

  const { status, body } = await get(`/reset?token=${token}`)

  t.is(status, 200)
  t.true(body.includes(token))
})

test.serial('the reset form sets a new password', async (t) => {
  const { user } = await account('reset-form@example.com')
  const token = await userTokens.issue(user.id, 'RESET')

  const response = await fetch(new URL('/reset', await base).href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, password: 'a-brand-new-password' }),
  })

  t.is(response.status, 200)
  t.regex(await response.text(), /password changed/i)

  const stored = await User.findOne({ id: user.id }).lean()

  // A reset also confirms the address: whoever opened the link reads that mailbox.
  t.true(stored.verified)
})

test.serial('the reset form refuses a short password', async (t) => {
  const { user } = await account('reset-short@example.com')
  const token = await userTokens.issue(user.id, 'RESET')

  const response = await fetch(new URL('/reset', await base).href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, password: 'short' }),
  })

  t.is(response.status, 400)

  // The token survives a rejected attempt, so the user can try again with a longer one.
  t.false((await User.findOne({ id: user.id }).lean()).verified)
})
