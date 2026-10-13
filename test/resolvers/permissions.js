import test from 'ava'
import listen from 'test-listen'

import { AUDIT_READ, EVENTS_MANAGE, REPORTS_READ } from '../../src/constants/permissions.js'
import { DEFAULT_WORKSPACE_ID } from '../../src/constants/workspaces.js'
import AuditLog from '../../src/models/AuditLog.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import Role from '../../src/models/Role.js'
import Token from '../../src/models/Token.js'
import User from '../../src/models/User.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

test.beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Membership.deleteMany({}),
    Token.deleteMany({}),
    Role.deleteMany({}),
    AuditLog.deleteMany({}),
    Domain.deleteMany({}),
  ])
})

// A signed-in user with one role in the default workspace.
const as = async (role, workspaceId = DEFAULT_WORKSPACE_ID) => {
  const user = await User.create({ email: `${role.toLowerCase()}-${Math.random()}@example.com`, verified: true })
  await Membership.create({ userId: user.id, workspaceId, role })
  const token = await Token.create({ userId: user.id })

  return { user, call: (query, variables) => api(base, { query, variables }, token.id) }
}

const denied = (json) => json.errors?.[0]?.message === 'You do not have permission to do this'

const listDomains = gql`
  query {
    domains {
      id
    }
  }
`
const createDomain = gql`
  mutation createDomain($input: CreateDomainInput!) {
    createDomain(input: $input) {
      payload {
        id
      }
    }
  }
`
const deleteDomain = gql`
  mutation deleteDomain($id: ID!) {
    deleteDomain(id: $id) {
      success
    }
  }
`
const createEvent = gql`
  mutation createEvent($input: CreateEventInput!) {
    createEvent(input: $input) {
      payload {
        id
      }
    }
  }
`
const listTokens = gql`
  query {
    permanentTokens {
      id
    }
  }
`
const readAudit = gql`
  query {
    auditLog {
      email
      action
      targetId
      workspaceId
      created
    }
  }
`

test.serial('a viewer reads reports and changes nothing', async (t) => {
  const viewer = await as('VIEWER')

  t.is((await viewer.call(listDomains)).json.errors, undefined)
  t.true(denied((await viewer.call(createDomain, { input: { title: 'Nope' } })).json))
  t.true(denied((await viewer.call(createEvent, { input: { title: 'Nope', type: 'TOTAL_CHART' } })).json))
  t.true(denied((await viewer.call(listTokens)).json))
  t.is(await Domain.countDocuments(), 0)
})

test.serial('an editor manages domains and events, not tokens or the audit log', async (t) => {
  const editor = await as('EDITOR')

  const created = await editor.call(createDomain, { input: { title: 'Site' } })
  t.is(created.json.errors, undefined)
  t.is((await editor.call(createEvent, { input: { title: 'Signup', type: 'TOTAL_CHART' } })).json.errors, undefined)
  t.is((await editor.call(deleteDomain, { id: created.json.data.createDomain.payload.id })).json.errors, undefined)

  t.true(denied((await editor.call(listTokens)).json))
  t.deepEqual((await editor.call(readAudit)).json.data.auditLog, [])
})

test.serial('the audit log tells who did what and when', async (t) => {
  const owner = await as('OWNER')
  const before = Date.now()

  const created = await owner.call(createDomain, { input: { title: 'Site' } })
  const id = created.json.data.createDomain.payload.id
  await owner.call(deleteDomain, { id })

  const { auditLog } = (await owner.call(readAudit)).json.data

  t.deepEqual(
    auditLog.map((entry) => [entry.action, entry.targetId, entry.email]),
    [
      ['domain.delete', id, owner.user.email],
      ['domain.create', id, owner.user.email],
    ],
  )
  t.true(new Date(auditLog[1].created).getTime() >= before - 1000)
})

test.serial('the audit log shows only workspaces where the viewer may read it', async (t) => {
  const owner = await as('OWNER')
  await AuditLog.create({ userId: 'someone', workspaceId: 'other-workspace', action: 'domain.create' })

  await owner.call(createDomain, { input: { title: 'Site' } })

  const { auditLog } = (await owner.call(readAudit)).json.data

  t.is(auditLog.length, 1)
  t.is(auditLog[0].workspaceId, DEFAULT_WORKSPACE_ID)
})

test.serial('a new role works without a release', async (t) => {
  await Role.create({ name: 'analyst', permissions: [REPORTS_READ, AUDIT_READ] })
  const analyst = await as('ANALYST')

  t.is((await analyst.call(listDomains)).json.errors, undefined)
  t.is((await analyst.call(readAudit)).json.errors, undefined)
  t.true(denied((await analyst.call(createDomain, { input: { title: 'Nope' } })).json))
})

test.serial('a stored role overrides the built-in one of the same name', async (t) => {
  await Role.create({ name: 'VIEWER', permissions: [REPORTS_READ, EVENTS_MANAGE] })
  const viewer = await as('VIEWER')

  t.is(
    (await viewer.call(createEvent, { input: { title: 'Allowed now', type: 'TOTAL_CHART' } })).json.errors,
    undefined,
  )
})

test.serial('an unknown role grants nothing', async (t) => {
  const owner = await as('OWNER')
  await owner.call(createDomain, { input: { title: 'Site' } })
  const stranger = await as('NOBODY')

  t.deepEqual((await stranger.call(listDomains)).json.data.domains, [])
  t.true(denied((await stranger.call(createDomain, { input: { title: 'Nope' } })).json))
})

test.serial('a role in another workspace does not count here', async (t) => {
  const owner = await as('OWNER')
  const site = await owner.call(createDomain, { input: { title: 'Site' } })
  const elsewhere = await as('OWNER', 'other-workspace')

  // Owner over there, nobody here: the domain does not exist for them.
  t.deepEqual((await elsewhere.call(listDomains)).json.data.domains, [])
  t.regex(
    (await elsewhere.call(deleteDomain, { id: site.json.data.createDomain.payload.id })).json.errors[0].message,
    /unknown domain/i,
  )
})

test('a role refuses a permission that does not exist', async (t) => {
  const error = await new Role({ name: 'BROKEN', permissions: ['EVERYTHING'] }).validate().catch((error_) => error_)

  t.not(error, undefined)
})
