import crypto from 'node:crypto'

import Invitation from '../models/Invitation.js'

// The same reasoning as in userTokens.js: the token has 256 bits of entropy, so a plain
// SHA-256 keeps a copy of the database from becoming a working link.
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex')

const response = (entry) => ({
  id: entry.id,
  workspaceId: entry.workspaceId,
  email: entry.email,
  role: entry.role,
  domainIds: entry.domainIds ?? [],
  invitedBy: entry.invitedBy,
  expires: entry.expires,
  created: entry.created,
})

const within = (workspaceIds) => ({ workspaceId: { $in: workspaceIds } })

const status = (entry) => {
  if (entry == null) return 'UNKNOWN'
  if (entry.used === true) return 'USED'
  if (entry.expires < new Date()) return 'EXPIRED'

  return 'OK'
}

// Issues an invitation and returns the token for the link. The token itself is never stored.
// An earlier pending invitation to the same address stops working: one link per person.
export const issue = async ({ workspaceId, email, role, domainIds }, invitedBy) => {
  const token = crypto.randomBytes(32).toString('base64url')

  await Invitation.updateMany({ workspaceId, email, used: false }, { $set: { used: true } })
  const entry = await Invitation.create({ workspaceId, email, role, domainIds, invitedBy, hash: digest(token) })

  return { invitation: response(entry), token }
}

// What a link points at, without using it up: the page shows it before asking for a password.
export const peek = async (token) => {
  const entry = await Invitation.findOne({ hash: digest(token) })
  const result = status(entry)

  return result === 'OK' ? { status: result, invitation: response(entry) } : { status: result }
}

// Uses the link up in one atomic step, so two clicks at the same moment cannot both win.
export const redeem = async (token) => {
  const entry = await Invitation.findOne({ hash: digest(token) })
  const result = status(entry)

  if (result !== 'OK') return { status: result }

  const claimed = await Invitation.findOneAndUpdate(
    { id: entry.id, used: false },
    { $set: { used: true } },
    { returnDocument: 'after' },
  )

  if (claimed == null) return { status: 'USED' }

  return { status: 'OK', invitation: response(claimed) }
}

// Invitations that can still be accepted, newest first.
export const pending = async (workspaceIds) => {
  const entries = await Invitation.find({ ...within(workspaceIds), used: false, expires: { $gt: new Date() } })
    .sort({ created: -1 })
    .lean()

  return entries.map(response)
}

// Marked as used rather than deleted, so a revoked link says "already used" instead of "unknown".
export const revoke = async (id, workspaceIds) => {
  const entry = await Invitation.findOneAndUpdate(
    { id, ...within(workspaceIds), used: false },
    { $set: { used: true } },
    { returnDocument: 'after' },
  )

  return entry == null ? null : response(entry)
}

// How many invitations went to an address recently. Used to rate limit sending.
export const recentCount = (workspaceId, email, since) =>
  Invitation.countDocuments({ workspaceId, email, created: { $gte: since } })
