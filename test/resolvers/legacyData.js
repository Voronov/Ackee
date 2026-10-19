import test from 'ava'
import listen from 'test-listen'

import { assignDefaultWorkspace } from '../../src/database/migrations.js'
import * as permanentTokens from '../../src/database/permanentTokens.js'
import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import PermanentToken from '../../src/models/PermanentToken.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// Written straight into the collection, the way an install from before workspaces and
// accounts left them: without `workspaceId` and without `userId`.
const legacy = async () => {
  const now = new Date()

  await Domain.collection.insertOne({ id: 'legacy-domain', title: 'legacy.example.com', created: now, updated: now })
  await Event.collection.insertOne({
    id: 'legacy-event',
    title: 'Legacy',
    type: 'TOTAL_CHART',
    created: now,
    updated: now,
  })
  await PermanentToken.collection.insertOne({ id: 'legacy-token', title: 'Legacy', created: now, updated: now })
}

const signIn = async () => {
  const admin = await users.ensureAdmin('admin@example.com')
  const token = await Token.create({ userId: admin.id })

  return (query, variables) => api(base, { query, variables }, token.id)
}

test.serial('domains and events from before workspaces stay with the admin', async (t) => {
  await legacy()
  t.deepEqual(await assignDefaultWorkspace(), { domains: 1, events: 1 })

  const call = await signIn()
  const { json } = await call(gql`
    query {
      domains {
        id
      }
      events {
        id
      }
      domain(id: "legacy-domain") {
        title
      }
    }
  `)

  t.is(json.errors, undefined)
  t.true(json.data.domains.some((domain) => domain.id === 'legacy-domain'))
  t.true(json.data.events.some((event) => event.id === 'legacy-event'))
  t.is(json.data.domain.title, 'legacy.example.com')
  // A second start finds nothing left to move
  t.deepEqual(await assignDefaultWorkspace(), { domains: 0, events: 0 })
})

test.serial('API tokens from before accounts can be listed and revoked by the admin', async (t) => {
  const call = await signIn()

  const { json: listed } = await call(gql`
    query {
      permanentTokens {
        id
      }
    }
  `)
  t.true(listed.data.permanentTokens.some((token) => token.id === 'legacy-token'))

  const { json: deleted } = await call(
    gql`
      mutation deletePermanentToken($id: ID!) {
        deletePermanentToken(id: $id) {
          success
        }
      }
    `,
    { id: 'legacy-token' },
  )
  t.true(deleted.data.deletePermanentToken.success)
  t.is(await PermanentToken.countDocuments({ id: 'legacy-token' }), 0)
})

test('API tokens are never read without their owner by accident', async (t) => {
  await t.throwsAsync(permanentTokens.all())
  await t.throwsAsync(permanentTokens.get('legacy-token'))
})
