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
