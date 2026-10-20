import { MEMBERS_MANAGE } from '../constants/permissions.js'
import { BUILT_IN_ROLES } from '../constants/roles.js'
import * as auditLog from '../database/auditLog.js'
import * as domains from '../database/domains.js'
import * as invitations from '../database/invitations.js'
import * as roles from '../database/roles.js'
import * as users from '../database/users.js'
import * as workspaces from '../database/workspaces.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import Role from '../models/Role.js'
import config from '../utils/config.js'
import { sendInvitation } from '../utils/emails.js'
import KnownError from '../utils/KnownError.js'
import { isEnabled as mailEnabled } from '../utils/mailer.js'
import { workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'
import { hour } from '../utils/times.js'

// A shape check, as in users.js: only the email itself can confirm the address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// At most three invitations per address and hour, so the form cannot flood a mailbox.
const MAXIMUM_INVITATIONS_PER_HOUR = 3

// Built-in or stored (ADR-003). An unknown role would grant nothing, which is a surprise
// better caught when the invitation is written.
const knownRole = async (name) => name in BUILT_IN_ROLES || (await Role.exists({ name })) != null

const manages = (viewer, workspaceId) => workspacesWith(viewer, MEMBERS_MANAGE).includes(workspaceId)

// Review of #33: an invitation can hand out at most what the inviter has in this workspace.
// Otherwise someone allowed to manage members could invite themselves, or a friend, as owner.
const grantable = async (viewer, workspaceId, role) => {
  if ((await knownRole(role)) === false) return false

  const own = viewer.memberships.find((membership) => membership.workspaceId === workspaceId)?.permissions ?? []
  const { [role]: granted = [] } = await roles.permissionsFor([role])

  return granted.every((permission) => own.includes(permission))
}

export default {
  Workspace: {
    canManageMembers: (parent, args, { viewer }) => manages(viewer, parent.id),
    members: (parent, args, { viewer }) => (manages(viewer, parent.id) ? users.members([parent.id]) : []),
    invitations: (parent, args, { viewer }) => (manages(viewer, parent.id) ? invitations.pending([parent.id]) : []),
    domains: (parent, args, { viewer }) => (manages(viewer, parent.id) ? domains.all([parent.id]) : []),
  },
  Query: {
    workspaces: pipe(requireAuth, async (parent, args, { viewer }) => {
      const roles = Object.fromEntries(
        viewer.memberships.map((membership) => [membership.workspaceId, membership.role]),
      )
      const entries = await workspaces.all(Object.keys(roles))

      return entries.map((entry) => ({ ...entry, role: roles[entry.id] }))
    }),
  },
  Mutation: {
    inviteMember: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      const email = String(input.email ?? '')
        .trim()
        .toLowerCase()
      const domainIds = [...new Set(input.domainIds)]

      // The same answer for a workspace that does not exist and one the viewer may not manage
      if (manages(viewer, input.workspaceId) === false) throw new KnownError('Unknown workspace')
      if (EMAIL.test(email) === false) throw new KnownError('Email address looks invalid')
      // The same answer for a role that does not exist and one the viewer may not hand out
      if ((await grantable(viewer, input.workspaceId, input.role)) === false) throw new KnownError('Unknown role')

      // A member's role changes elsewhere, never through an invitation: that would also let the
      // last owner invite themselves as a viewer and leave the workspace without one
      const existing = await users.byEmail(email)
      if (
        existing != null &&
        (await users.memberships(existing.id)).some((entry) => entry.workspaceId === input.workspaceId)
      ) {
        throw new KnownError('This address is already a member of the workspace')
      }

      // Without outgoing mail the link would never reach anyone, the same rule as registration
      if (mailEnabled() === false && config.isDevelopmentMode !== true) {
        throw new KnownError('Invitations need outgoing email, which is not configured')
      }

      // Only domains of this workspace: anything else would hand out someone else's data
      if (domainIds.length > 0) {
        const known = new Set((await domains.all([input.workspaceId])).map((domain) => domain.id))

        if (domainIds.some((id) => known.has(id) === false)) throw new KnownError('Unknown domain')
      }

      // Per workspace and address, so one workspace cannot use up the invitations of another
      if (
        (await invitations.recentCount(input.workspaceId, email, new Date(Date.now() - hour))) >=
        MAXIMUM_INVITATIONS_PER_HOUR
      ) {
        throw new KnownError('Too many invitations to this address, try again later')
      }

      const [workspace] = await workspaces.all([input.workspaceId])
      const { invitation, token } = await invitations.issue(
        { workspaceId: input.workspaceId, email, role: input.role, domainIds },
        viewer.userId,
      )

      await sendInvitation(email, token, { workspaceTitle: workspace.title, invitedBy: viewer.email })
      await auditLog.record(viewer, input.workspaceId, 'member.invite', invitation.id)

      return { success: true, payload: invitation }
    }),
    revokeInvitation: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      const entry = await invitations.revoke(id, workspacesWith(viewer, MEMBERS_MANAGE))

      if (entry == null) throw new KnownError('Unknown invitation')

      await auditLog.record(viewer, entry.workspaceId, 'invitation.revoke', entry.id)

      return { success: true }
    }),
    removeMember: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      const result = await users.leave(id, workspacesWith(viewer, MEMBERS_MANAGE))

      if (result.status === 'LAST_OWNER') throw new KnownError('The last owner cannot be removed')
      if (result.status !== 'OK') throw new KnownError('Unknown member')

      await auditLog.record(viewer, result.member.workspaceId, 'member.remove', result.member.userId)

      return { success: true }
    }),
  },
}
