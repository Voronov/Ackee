import test from 'ava'
import listen from 'test-listen'

import * as tokens from '../src/database/tokens.js'
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

test.serial('stops answering one address after too many requests', async (t) => {
  const from = { 'X-Forwarded-For': '203.0.113.7' }
  const statuses = []

  for (let index = 0; index < 31; index++) {
    const response = await fetch(new URL('/verify?token=nothing', await base).href, { headers: from })
    statuses.push(response.status)
  }

  t.is(statuses.filter((status) => status === 400).length, 30)
  t.is(statuses.at(-1), 429)

  // The limit belongs to the links, not to the rest of the app
  const api = await fetch(new URL('/api', await base).href, {
    method: 'POST',
    headers: { ...from, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
  })
  t.is(api.status, 200)
  t.is((await fetch(new URL('/tracker.js', await base).href, { headers: from })).status, 200)
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
  const session = await tokens.add(user.id)
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
  // And signs the user out everywhere, the old password may be known to someone else
  t.is(await tokens.get(session.id), null)
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
