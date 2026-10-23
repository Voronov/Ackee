import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import * as invitations from '../../src/database/invitations.js'
import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import Invitation from '../../src/models/Invitation.js'
import Membership from '../../src/models/Membership.js'
import Role from '../../src/models/Role.js'
import Token from '../../src/models/Token.js'
import User from '../../src/models/User.js'
import server from '../../src/server.js'
import signale from '../../src/utils/signale.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// Emails go to the log in development mode, so the test can read the link
let restoreEnv
const logged = []
const info = signale.info

test.before(() => {
  restoreEnv = mockedEnv({ NODE_ENV: 'development' })
  signale.info = (message) => logged.push(String(message))
})

test.after.always(() => {
  signale.info = info
  restoreEnv()
})

const lastLink = () =>
  logged
    .join('\n')
    .match(/invitation\?token=([\w-]+)/g)
    ?.at(-1)
    ?.split('=')[1]

const account = async (email) => {
  const { user, workspace } = await users.add({ email, password: 'sufficiently-long' })
  await users.verify(user.id)
  const token = await Token.create({ userId: user.id })

  return { user, workspace, call: (query, variables) => api(base, { query, variables }, token.id) }
}

const invite = (call, input) =>
  call(
    gql`
      mutation inviteMember($input: InviteMemberInput!) {
        inviteMember(input: $input) {
          success
          payload {
            id
            email
            role
            domainIds
          }
        }
      }
    `,
    { input },
  )

const form = async (path, body) => {
  const response = await fetch(new URL(path, await base).href, {
    method: body == null ? 'GET' : 'POST',
    headers: body == null ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body == null ? undefined : new URLSearchParams(body),
  })

  return { status: response.status, body: await response.text() }
}

const domainTitles = async (call) => {
  const { json } = await call(gql`
    query {
      domains {
        title
      }
    }
  `)

  return json.data.domains.map((domain) => domain.title).toSorted()
}

test.serial('an owner invites a new person, who registers from the link and sees the workspace', async (t) => {
  const owner = await account('owner-1@example.com')
  await Domain.create({ title: 'shop.example.com', workspaceId: owner.workspace.id })

  const { json } = await invite(owner.call, {
    workspaceId: owner.workspace.id,
    email: 'New-1@Example.com',
    role: 'VIEWER',
  })
  t.true(json.data.inviteMember.success)
  t.is(json.data.inviteMember.payload.email, 'new-1@example.com')

  const token = lastLink()
  const page = await form(`/invitation?token=${token}`)
  t.is(page.status, 200)
  t.regex(page.body, /new account/i)

  const joined = await form('/invitation', { token, password: 'another-long-one' })
  t.is(joined.status, 200)
  t.regex(joined.body, /accepted/i)

  const user = await User.findOne({ email: 'new-1@example.com' }).lean()
  t.true(user.verified)

  const memberships = await Membership.find({ userId: user.id }).lean()
  t.deepEqual(memberships.map((membership) => membership.role).toSorted(), ['OWNER', 'VIEWER'])

  const signedIn = await Token.create({ userId: user.id })
  const call = (query, variables) => api(base, { query, variables }, signedIn.id)
  t.deepEqual(await domainTitles(call), ['shop.example.com'])
})

test.serial('an existing user accepts with their own password', async (t) => {
  const owner = await account('owner-2@example.com')
  const guest = await account('guest-2@example.com')

  await invite(owner.call, { workspaceId: owner.workspace.id, email: 'guest-2@example.com', role: 'EDITOR' })
  const token = lastLink()

  t.regex((await form(`/invitation?token=${token}`)).body, /password of your account/i)

  const wrong = await form('/invitation', { token, password: 'not-the-password' })
  t.is(wrong.status, 400)
  t.regex(wrong.body, /wrong password/i)

  // A typo does not use the link up
  const right = await form('/invitation', { token, password: 'sufficiently-long' })
  t.is(right.status, 200)

  const membership = await Membership.findOne({ userId: guest.user.id, workspaceId: owner.workspace.id }).lean()
  t.is(membership.role, 'EDITOR')
})

test.serial('an invitation limited to some domains shows only those domains', async (t) => {
  const owner = await account('owner-3@example.com')
  const shop = await Domain.create({ title: 'shop-3.example.com', workspaceId: owner.workspace.id })
  await Domain.create({ title: 'journal-3.example.com', workspaceId: owner.workspace.id })
  await Event.create({ title: 'Signups', type: 'TOTAL_CHART', workspaceId: owner.workspace.id })
  const guest = await account('guest-3@example.com')

  const { json } = await invite(owner.call, {
    workspaceId: owner.workspace.id,
    email: 'guest-3@example.com',
    role: 'EDITOR',
    domainIds: [shop.id],
  })
  t.deepEqual(json.data.inviteMember.payload.domainIds, [shop.id])

  await form('/invitation', { token: lastLink(), password: 'sufficiently-long' })

  t.deepEqual(await domainTitles(guest.call), ['shop-3.example.com'])

  // Nothing workspace-wide: no events, and new domains land in the guest's own workspace
  const { json: events } = await guest.call(gql`
    query {
      events {
        id
      }
    }
  `)
  t.deepEqual(events.data.events, [])

  const { json: created } = await guest.call(
    gql`
      mutation createDomain($input: CreateDomainInput!) {
        createDomain(input: $input) {
          payload {
            id
          }
        }
      }
    `,
    { input: { title: 'own.example.com' } },
  )
  const own = await Domain.findOne({ id: created.data.createDomain.payload.id }).lean()
  t.is(own.workspaceId, guest.workspace.id)

  // EDITOR on the shared domain still edits it
  const { json: renamed } = await guest.call(
    gql`
      mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
        updateDomain(id: $id, input: $input) {
          payload {
            title
          }
        }
      }
    `,
    { id: shop.id, input: { title: 'shop-3b.example.com' } },
  )
  t.is(renamed.data.updateDomain.payload.title, 'shop-3b.example.com')
})

test.serial('only members who manage members can invite, and only to their domains', async (t) => {
  const owner = await account('owner-4@example.com')
  const stranger = await account('stranger-4@example.com')
  const foreign = await Domain.create({ title: 'foreign-4.example.com', workspaceId: stranger.workspace.id })

  const outsider = await invite(stranger.call, {
    workspaceId: owner.workspace.id,
    email: 'x-4@example.com',
    role: 'VIEWER',
  })
  t.regex(outsider.json.errors[0].message, /unknown workspace/i)

  const otherDomain = await invite(owner.call, {
    workspaceId: owner.workspace.id,
    email: 'x-4@example.com',
    role: 'VIEWER',
    domainIds: [foreign.id],
  })
  t.regex(otherDomain.json.errors[0].message, /unknown domain/i)

  const role = await invite(owner.call, { workspaceId: owner.workspace.id, email: 'x-4@example.com', role: 'GOD' })
  t.regex(role.json.errors[0].message, /unknown role/i)

  const email = await invite(owner.call, { workspaceId: owner.workspace.id, email: 'nope', role: 'VIEWER' })
  t.regex(email.json.errors[0].message, /looks invalid/i)

  t.is(await Invitation.countDocuments({ email: 'x-4@example.com' }), 0)
})

test.serial('a link works once, a revoked or a replaced one not at all', async (t) => {
  const owner = await account('owner-5@example.com')
  const invitation = (email) => invite(owner.call, { workspaceId: owner.workspace.id, email, role: 'VIEWER' })

  await invitation('once-5@example.com')
  const token = lastLink()
  await form('/invitation', { token, password: 'sufficiently-long' })
  t.regex((await form(`/invitation?token=${token}`)).body, /already used/i)

  const { json } = await invitation('revoked-5@example.com')
  const revokedToken = lastLink()
  await owner.call(
    gql`
      mutation revokeInvitation($id: ID!) {
        revokeInvitation(id: $id) {
          success
        }
      }
    `,
    { id: json.data.inviteMember.payload.id },
  )
  t.is((await form('/invitation', { token: revokedToken, password: 'sufficiently-long' })).status, 400)
  t.is(await User.countDocuments({ email: 'revoked-5@example.com' }), 0)

  await invitation('twice-5@example.com')
  const first = lastLink()
  await invitation('twice-5@example.com')
  t.regex((await form(`/invitation?token=${first}`)).body, /already used/i)

  t.regex((await form('/invitation?token=nonsense')).body, /not valid/i)
})

test.serial('an expired link is refused', async (t) => {
  const owner = await account('owner-6@example.com')
  const { token } = await invitations.issue(
    { workspaceId: owner.workspace.id, email: 'late-6@example.com', role: 'VIEWER', domainIds: [] },
    owner.user.id,
  )
  await Invitation.updateOne({ email: 'late-6@example.com' }, { $set: { expires: new Date(Date.now() - 1000) } })

  const { status, body } = await form(`/invitation?token=${token}`)
  t.is(status, 400)
  t.regex(body, /expired/i)
  t.regex(body, /a week/i)
})

test.serial('at most three invitations to one address per hour', async (t) => {
  const owner = await account('owner-7@example.com')
  const send = () =>
    invite(owner.call, { workspaceId: owner.workspace.id, email: 'flood-7@example.com', role: 'VIEWER' })

  for (let index = 0; index < 3; index++) t.true((await send()).json.data.inviteMember.success)

  t.regex((await send()).json.errors[0].message, /too many/i)
})

const workspaceView = async (call) => {
  const { json } = await call(gql`
    query {
      workspaces {
        id
        role
        canManageMembers
        members {
          id
          email
          role
        }
        invitations {
          email
        }
      }
    }
  `)

  return json.data.workspaces
}

test.serial('owners see members and pending invitations, viewers see neither', async (t) => {
  const owner = await account('owner-8@example.com')
  await invite(owner.call, { workspaceId: owner.workspace.id, email: 'viewer-8@example.com', role: 'VIEWER' })
  await form('/invitation', { token: lastLink(), password: 'sufficiently-long' })
  await invite(owner.call, { workspaceId: owner.workspace.id, email: 'pending-8@example.com', role: 'VIEWER' })

  const [own] = await workspaceView(owner.call)
  t.true(own.canManageMembers)
  t.deepEqual(
    own.members.map((member) => member.email),
    ['owner-8@example.com', 'viewer-8@example.com'],
  )
  t.deepEqual(
    own.invitations.map((invitation) => invitation.email),
    ['pending-8@example.com'],
  )

  const viewer = await User.findOne({ email: 'viewer-8@example.com' }).lean()
  const token = await Token.create({ userId: viewer.id })
  const views = await workspaceView((query, variables) => api(base, { query, variables }, token.id))
  const shared = views.find((workspace) => workspace.id === owner.workspace.id)

  t.is(shared.role, 'VIEWER')
  t.false(shared.canManageMembers)
  t.deepEqual(shared.members, [])
  t.deepEqual(shared.invitations, [])
})

test.serial('an owner removes a member, but never the last owner', async (t) => {
  const owner = await account('owner-9@example.com')
  await invite(owner.call, { workspaceId: owner.workspace.id, email: 'leaving-9@example.com', role: 'VIEWER' })
  await form('/invitation', { token: lastLink(), password: 'sufficiently-long' })

  const [own] = await workspaceView(owner.call)
  const remove = (id) =>
    owner.call(
      gql`
        mutation removeMember($id: ID!) {
          removeMember(id: $id) {
            success
          }
        }
      `,
      { id },
    )

  const leaving = own.members.find((member) => member.email === 'leaving-9@example.com')
  t.true((await remove(leaving.id)).json.data.removeMember.success)

  const self = own.members.find((member) => member.email === 'owner-9@example.com')
  t.regex((await remove(self.id)).json.errors[0].message, /last owner/i)

  const [after] = await workspaceView(owner.call)
  t.deepEqual(
    after.members.map((member) => member.email),
    ['owner-9@example.com'],
  )
})

test.serial('a new account from an invitation needs a long enough password', async (t) => {
  const owner = await account('owner-10@example.com')
  await invite(owner.call, { workspaceId: owner.workspace.id, email: 'short-10@example.com', role: 'VIEWER' })
  const token = lastLink()

  const short = await form('/invitation', { token, password: 'short' })
  t.is(short.status, 400)
  t.regex(short.body, /too short/i)

  // The link still works after the mistake
  t.is((await form('/invitation', { token, password: 'sufficiently-long' })).status, 200)
})

test.serial('a link that is not ours never reaches the page', async (t) => {
  const { status, body } = await form('/invitation?token=%3Cscript%3E')

  t.is(status, 400)
  t.regex(body, /not valid/i)
  t.false(body.toLowerCase().includes('<script'))
})

// Review of #33: someone who may only manage members must not hand out more than they have
test.serial('an invitation cannot grant more than the inviter has', async (t) => {
  const owner = await account('owner-11@example.com')
  await Role.create({ name: 'MANAGER', permissions: ['MEMBERS_MANAGE'] })
  const manager = await account('manager-11@example.com')
  await Membership.create({ userId: manager.user.id, workspaceId: owner.workspace.id, role: 'MANAGER' })

  for (const role of ['OWNER', 'VIEWER', 'EDITOR']) {
    const { json } = await invite(manager.call, {
      workspaceId: owner.workspace.id,
      email: `friend-11-${role}@example.com`,
      role,
    })
    t.regex(json.errors[0].message, /unknown role/i, role)
  }

  const { json } = await invite(manager.call, {
    workspaceId: owner.workspace.id,
    email: 'peer-11@example.com',
    role: 'MANAGER',
  })
  t.true(json.data.inviteMember.success)
  t.is(await Invitation.countDocuments({ workspaceId: owner.workspace.id, role: 'OWNER' }), 0)
})

test.serial('members, the inviter included, are not invited again', async (t) => {
  const owner = await account('owner-12@example.com')
  const member = await account('member-12@example.com')
  await Membership.create({ userId: member.user.id, workspaceId: owner.workspace.id, role: 'VIEWER' })

  const self = await invite(owner.call, {
    workspaceId: owner.workspace.id,
    email: 'owner-12@example.com',
    role: 'VIEWER',
  })
  t.regex(self.json.errors[0].message, /already a member/i)
  const other = await invite(owner.call, {
    workspaceId: owner.workspace.id,
    email: 'member-12@example.com',
    role: 'OWNER',
  })
  t.regex(other.json.errors[0].message, /already a member/i)
})

test.serial('accepting never changes a membership, so the last owner stays an owner', async (t) => {
  const owner = await account('owner-13@example.com')
  // An invitation from before, to the owner's own address, as a viewer
  const { token } = await invitations.issue(
    { workspaceId: owner.workspace.id, email: 'owner-13@example.com', role: 'VIEWER', domainIds: [] },
    owner.user.id,
  )

  const { status, body } = await form('/invitation', { token, password: 'sufficiently-long' })
  t.is(status, 200)
  t.regex(body, /already a member/i)

  const membership = await Membership.findOne({ userId: owner.user.id, workspaceId: owner.workspace.id }).lean()
  t.is(membership.role, 'OWNER')
})

test.serial('the invitation limit counts per workspace', async (t) => {
  const first = await account('owner-14a@example.com')
  const second = await account('owner-14b@example.com')
  const send = (owner) =>
    invite(owner.call, { workspaceId: owner.workspace.id, email: 'popular-14@example.com', role: 'VIEWER' })

  for (let index = 0; index < 3; index++) t.true((await send(first)).json.data.inviteMember.success)
  t.regex((await send(first)).json.errors[0].message, /too many/i)
  t.true((await send(second)).json.data.inviteMember.success)
})

const removeAs = (call, id) =>
  call(
    gql`
      mutation removeMember($id: ID!) {
        removeMember(id: $id) {
          success
        }
      }
    `,
    { id },
  )

// Review of #33: the rule of invitations the other way round
test.serial('a member is removed only by someone holding everything their role grants', async (t) => {
  const owner = await account('owner-15@example.com')
  await Role.create({ name: 'STAFF', permissions: ['MEMBERS_MANAGE'] })
  const staff = await account('staff-15@example.com')
  const other = await account('other-15@example.com')
  const viewer = await account('viewer-15@example.com')
  const peer = await account('peer-15@example.com')
  const workspaceId = owner.workspace.id
  await Membership.create({ userId: staff.user.id, workspaceId, role: 'STAFF' })
  const second = await Membership.create({ userId: other.user.id, workspaceId, role: 'OWNER' })
  const third = await Membership.create({ userId: viewer.user.id, workspaceId, role: 'VIEWER' })
  const fourth = await Membership.create({ userId: peer.user.id, workspaceId, role: 'STAFF' })

  // Not the last owner, still out of reach for someone who only manages members
  t.regex((await removeAs(staff.call, second.id)).json.errors[0].message, /unknown member/i)
  t.is(await Membership.countDocuments({ workspaceId, role: 'OWNER' }), 2)
  // A viewer reads reports, which the staff role does not grant
  t.regex((await removeAs(staff.call, third.id)).json.errors[0].message, /unknown member/i)

  t.true((await removeAs(staff.call, fourth.id)).json.data.removeMember.success)
  t.true((await removeAs(owner.call, second.id)).json.data.removeMember.success)
  t.true((await removeAs(owner.call, third.id)).json.data.removeMember.success)
  t.is(await Membership.countDocuments({ workspaceId }), 2)
})

test.serial('two removals at the same time never leave a workspace without an owner', async (t) => {
  const first = await account('owner-16a@example.com')
  const second = await account('owner-16b@example.com')
  const workspaceId = first.workspace.id
  const own = await Membership.findOne({ userId: first.user.id, workspaceId }).lean()
  const owners = () => Membership.countDocuments({ workspaceId, role: 'OWNER' })

  for (let round = 0; round < 20; round++) {
    const added = await Membership.create({ userId: second.user.id, workspaceId, role: 'OWNER' })
    const results = await Promise.all([removeAs(first.call, added.id), removeAs(second.call, own.id)])

    t.true((await owners()) >= 1, `round ${round}`)
    t.true(
      results.some(({ json }) => /last owner/i.test(json.errors?.[0]?.message ?? '')),
      `round ${round}`,
    )

    // Back to the two owners for the next round: the one left may be either of them
    await Membership.deleteMany({ workspaceId, userId: second.user.id })
    await Membership.updateOne({ userId: first.user.id, workspaceId }, { $setOnInsert: own }, { upsert: true })
  }

  const [remaining] = await Membership.find({ workspaceId }).lean()
  t.is(remaining.userId, first.user.id)
  t.is(remaining.leaving, undefined)
})
