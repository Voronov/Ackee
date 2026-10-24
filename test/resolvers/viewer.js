import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import { BUILT_IN_ROLES, ROLE_OWNER } from '../../src/constants/roles.js'
import { DEFAULT_WORKSPACE_ID } from '../../src/constants/workspaces.js'
import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import PermanentToken from '../../src/models/PermanentToken.js'
import Token from '../../src/models/Token.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
import server from '../../src/server.js'
import KnownError from '../../src/utils/KnownError.js'
import resolveViewer from '../../src/utils/viewer.js'
import { day } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

const bearer = (id) => `Bearer ${id}`

test.serial('the env admin is created once, as owner of the default workspace', async (t) => {
  const email = 'once@example.com'

  // The unique indexes are what stop a second admin, so they must exist, as on a running server.
  await Promise.all([User.init(), Workspace.init(), Membership.init()])

  const [first, second] = await Promise.all([users.ensureAdmin(email), users.ensureAdmin(email)])

  t.is(first.id, second.id)
  t.is(await User.countDocuments({ email }), 1)
  t.deepEqual(await users.memberships(first.id), [
    { workspaceId: DEFAULT_WORKSPACE_ID, role: ROLE_OWNER, domainIds: [] },
  ])
  t.not(await Workspace.findOne({ id: DEFAULT_WORKSPACE_ID }), null)

  await Membership.deleteMany({ userId: first.id })
  await User.deleteOne({ id: first.id })
})

test('a user cannot hold two roles in one workspace', async (t) => {
  await Membership.init()

  await t.throwsAsync(
    Membership.create({ userId: t.context.user.id, workspaceId: DEFAULT_WORKSPACE_ID, role: ROLE_OWNER }),
    { code: 11_000 },
  )
})

test('a session token tells who the viewer is and where they belong', async (t) => {
  const viewer = await resolveViewer(bearer(t.context.token.id), day)

  t.is(viewer.userId, t.context.user.id)
  t.is(viewer.email, t.context.user.email)
  t.deepEqual(viewer.memberships, [
    { workspaceId: DEFAULT_WORKSPACE_ID, role: ROLE_OWNER, domainIds: [], permissions: BUILT_IN_ROLES[ROLE_OWNER] },
  ])
})

test('a permanent token tells who the viewer is', async (t) => {
  const viewer = await resolveViewer(bearer(t.context.permanentToken.id), day)

  t.is(viewer.userId, t.context.user.id)
})

test.serial('a token from before accounts belongs to the env admin', async (t) => {
  const legacy = await Token.create({})
  const restore = mockedEnv({ ACKEE_USERNAME: 'legacy@example.com' })

  const viewer = await resolveViewer(bearer(legacy.id), day)

  restore()

  t.is(viewer.email, 'legacy@example.com')
  t.deepEqual(viewer.memberships, [
    { workspaceId: DEFAULT_WORKSPACE_ID, role: ROLE_OWNER, domainIds: [], permissions: BUILT_IN_ROLES[ROLE_OWNER] },
  ])

  await Membership.deleteMany({ userId: viewer.userId })
  await User.deleteOne({ id: viewer.userId })
  await Token.deleteOne({ id: legacy.id })
})

test.serial('a token from before accounts is refused without an env admin', async (t) => {
  const legacy = await PermanentToken.create({ title: 'Legacy' })
  const restore = mockedEnv({ ACKEE_USERNAME: undefined })

  const viewer = await resolveViewer(bearer(legacy.id), day)

  restore()

  t.true(viewer instanceof KnownError)
  t.is(viewer.message, 'Token invalid')

  await PermanentToken.deleteOne({ id: legacy.id })
})

test('a token whose user is gone is refused', async (t) => {
  const orphan = await Token.create({ userId: 'deleted-user' })

  const viewer = await resolveViewer(bearer(orphan.id), day)

  t.is(viewer.message, 'Token invalid')

  await Token.deleteOne({ id: orphan.id })
})

test.serial('signing in with the env credentials gives a token of the admin', async (t) => {
  const restore = mockedEnv({ ACKEE_USERNAME: 'signin@example.com', ACKEE_PASSWORD: 'secret' })

  const { json } = await api(base, {
    query: gql`
      mutation createToken($input: CreateTokenInput!) {
        createToken(input: $input) {
          payload {
            id
          }
        }
      }
    `,
    variables: { input: { username: 'signin@example.com', password: 'secret' } },
  })

  restore()

  const token = await Token.findOne({ id: json.data.createToken.payload.id })
  const admin = await users.byEmail('signin@example.com')

  t.is(token.userId, admin.id)
  t.deepEqual(await users.memberships(admin.id), [
    { workspaceId: DEFAULT_WORKSPACE_ID, role: ROLE_OWNER, domainIds: [] },
  ])

  await Membership.deleteMany({ userId: admin.id })
  await User.deleteOne({ id: admin.id })
  await Token.deleteOne({ id: token.id })
})

test('a new permanent token belongs to whoever created it', async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        mutation createPermanentToken($input: CreatePermanentTokenInput!) {
          createPermanentToken(input: $input) {
            payload {
              id
            }
          }
        }
      `,
      variables: { input: { title: 'Mine' } },
    },
    t.context.token.id,
  )

  const entry = await PermanentToken.findOne({ id: json.data.createPermanentToken.payload.id })

  t.is(entry.userId, t.context.user.id)

  await PermanentToken.deleteOne({ id: entry.id })
})

test('a new domain lands in the default workspace', async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        mutation createDomain($input: CreateDomainInput!) {
          createDomain(input: $input) {
            payload {
              id
            }
          }
        }
      `,
      variables: { input: { title: 'Workspace test' } },
    },
    t.context.token.id,
  )

  const entry = await Domain.findOne({ id: json.data.createDomain.payload.id })

  t.is(entry.workspaceId, DEFAULT_WORKSPACE_ID)

  await Domain.deleteOne({ id: entry.id })
})
