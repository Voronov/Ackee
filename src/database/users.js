import { PERMISSIONS } from '../constants/permissions.js'
import { ROLE_OWNER } from '../constants/roles.js'
import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import Membership from '../models/Membership.js'
import PermanentToken from '../models/PermanentToken.js'
import Token from '../models/Token.js'
import User from '../models/User.js'
import Workspace from '../models/Workspace.js'
import { hash } from '../utils/password.js'
import { minute } from '../utils/times.js'
import { permissionsFor } from './roles.js'

const response = (entry) => ({
  id: entry.id,
  email: entry.email,
  verified: entry.verified,
  created: entry.created,
  updated: entry.updated,
})

// Upserts, so two sign-ins at the same moment cannot create the admin twice. When both
// still race to insert, the unique index refuses one of them and it reads the winner.
const upsert = async (Model, filter, data = {}) => {
  const options = { upsert: true, returnDocument: 'after' }

  try {
    return await Model.findOneAndUpdate(filter, { $setOnInsert: { ...filter, ...data } }, options)
  } catch (error) {
    if (error.code !== 11_000) throw error

    return Model.findOne(filter)
  }
}

/*
 * The account behind ACKEE_USERNAME, owner of the default workspace.
 *
 * Created on first sign-in rather than at start, so an existing install keeps working
 * without a migration step.
 */
export const ensureAdmin = async (email) => {
  const user = await upsert(User, { email: String(email).trim().toLowerCase() }, { verified: true })

  await upsert(Workspace, { id: DEFAULT_WORKSPACE_ID }, { title: 'Default' })
  await upsert(Membership, { userId: user.id, workspaceId: DEFAULT_WORKSPACE_ID }, { role: ROLE_OWNER })
  // API tokens from before accounts have no owner. They already sign in as the admin, and
  // now the admin can also see and revoke them.
  await PermanentToken.updateMany({ userId: { $exists: false } }, { $set: { userId: user.id } })

  return response(user)
}

export const get = async (id) => {
  const entry = await User.findOne({ id })

  return entry == null ? entry : response(entry)
}

export const byEmail = async (email) => {
  const entry = await User.findOne({ email: String(email).trim().toLowerCase() })

  return entry == null ? entry : response(entry)
}

/*
 * Registers a user together with a personal workspace.
 *
 * Domains belong to a workspace, so without one a new account would have nowhere to put a
 * domain. A single user never sees it: for them it is simply "my domains".
 */
export const add = async ({ email, password }) => {
  const user = await User.create({ email, password: await hash(password) })
  const workspace = await Workspace.create({ title: 'Personal' })

  await Membership.create({ userId: user.id, workspaceId: workspace.id, role: ROLE_OWNER })

  return { user: response(user), workspace: { id: workspace.id, title: workspace.title } }
}

// Setting a password also confirms the address: whoever opened the link from the email
// can read that mailbox, which is exactly what confirmation proves.
export const setPassword = async (id, password) => {
  const entry = await User.findOneAndUpdate(
    { id },
    { $set: { password: await hash(password), verified: true, updated: Date.now() } },
    { returnDocument: 'after' },
  )

  return entry == null ? null : response(entry)
}

export const verify = async (id) => {
  const entry = await User.findOneAndUpdate(
    { id },
    { $set: { verified: true, updated: Date.now() } },
    { returnDocument: 'after' },
  )

  return entry == null ? entry : response(entry)
}

// For signing in only: the one place the password hash leaves this module.
export const credentials = async (email) => {
  const entry = await User.findOne({ email: String(email).trim().toLowerCase() })

  return entry == null ? entry : { ...response(entry), password: entry.password }
}

// A user's workspaces and their role in each.
export const memberships = async (userId) => {
  const entries = await Membership.find({ userId }).lean()

  return entries.map((entry) => ({
    workspaceId: entry.workspaceId,
    role: entry.role,
    domainIds: entry.domainIds ?? [],
  }))
}

const member = (entry, user) => ({
  id: entry.id,
  userId: entry.userId,
  email: user?.email ?? '',
  role: entry.role,
  domainIds: entry.domainIds ?? [],
  workspaceId: entry.workspaceId,
  created: entry.created,
})

// The members of the given workspaces, with their addresses.
export const members = async (workspaceIds) => {
  const entries = await Membership.find({ workspaceId: { $in: workspaceIds } }).lean()
  const accounts = await User.find({ id: { $in: entries.map((entry) => entry.userId) } }).lean()
  const byId = Object.fromEntries(accounts.map((account) => [account.id, account]))

  return entries.map((entry) => member(entry, byId[entry.userId])).toSorted((a, b) => a.email.localeCompare(b.email))
}

// Adds a user to a workspace. Someone who is a member already keeps their role and domains: an
// invitation never changes a membership, so it cannot demote the last owner either.
export const join = async (userId, workspaceId, { role, domainIds }) => {
  const entry = await Membership.findOneAndUpdate(
    { userId, workspaceId },
    { $setOnInsert: { userId, workspaceId, role, domainIds } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true },
  )

  return {
    member: member(entry.value, await User.findOne({ id: userId }).lean()),
    existing: entry.lastErrorObject?.updatedExisting === true,
  }
}

// One membership of the given workspaces, with the fields `leave` and the resolver need.
export const membership = (id, workspaceIds) => Membership.findOne({ id, workspaceId: { $in: workspaceIds } }).lean()

// A mark older than a minute is from a removal that died halfway and does not count
const notLeaving = () => ({ leaving: { $not: { $gt: new Date(Date.now() - minute) } } })

// Owners by what their roles grant, not by the name OWNER (review of #33): every permission,
// workspace-wide. Nobody can hand out more than they hold, so without such a member the
// workspace could never be fully managed again.
const ownersAmong = async (entries) => {
  const granted = await permissionsFor([...new Set(entries.map((entry) => entry.role))])

  return entries.filter(
    (entry) =>
      (entry.domainIds ?? []).length === 0 &&
      PERMISSIONS.every((permission) => granted[entry.role].includes(permission)),
  )
}

// Removes a member. The last owner stays: a workspace without one could never be managed again.
// The one leaving is marked first and the marked are not counted, so two removals at the same
// time cannot both pass the count and leave no owner behind.
export const leave = async (entry) => {
  const marked = await Membership.findOneAndUpdate({ id: entry.id, ...notLeaving() }, { $set: { leaving: new Date() } })

  if (marked == null) return { status: 'UNKNOWN' }

  const [leavingOwner] = await ownersAmong([entry])
  const others = await Membership.find({ workspaceId: entry.workspaceId, ...notLeaving() }).lean()

  if (leavingOwner != null && (await ownersAmong(others)).length === 0) {
    await Membership.updateOne({ id: entry.id }, { $unset: { leaving: 1 } })

    return { status: 'LAST_OWNER' }
  }

  await Membership.deleteOne({ id: entry.id })

  return { status: 'OK', member: member(entry, await User.findOne({ id: entry.userId }).lean()) }
}

export const byGoogleId = async (googleId) => {
  const entry = await User.findOne({ googleId })

  return entry == null ? entry : { ...response(entry), googleId: entry.googleId }
}

// The account behind an address, with its Google link. For signing in with Google only.
export const withGoogleId = async (email) => {
  const entry = await User.findOne({ email: String(email).trim().toLowerCase() })

  return entry == null ? entry : { ...response(entry), googleId: entry.googleId }
}

// Links a Google account. Google has confirmed the address, so the account counts as confirmed too.
export const linkGoogle = async (id, googleId) => {
  const current = await User.findOne({ id }).lean()
  if (current == null) return null

  // A password set before the address was confirmed proves nothing: anyone can register someone
  // else's address and wait for its owner to confirm it with Google. So it goes, with every
  // session, and the owner sets a password of their own with "Forgot password".
  const unconfirmed = current.verified !== true

  const entry = await User.findOneAndUpdate(
    { id },
    {
      $set: { googleId, verified: true, updated: Date.now() },
      ...(unconfirmed ? { $unset: { password: 1 } } : {}),
    },
    { returnDocument: 'after' },
  )
  if (unconfirmed) await Token.deleteMany({ userId: id })

  return entry == null ? entry : response(entry)
}

/*
 * Registers a user who signed in with Google, with a personal workspace like `add`.
 *
 * No password: the account signs in through Google until the owner sets one with "Forgot
 * password". The address is confirmed, because Google says so (email_verified).
 */
export const addFromGoogle = async ({ email, googleId }) => {
  const user = await User.create({ email, googleId, verified: true })
  const workspace = await Workspace.create({ title: 'Personal' })

  await Membership.create({ userId: user.id, workspaceId: workspace.id, role: ROLE_OWNER })

  return { user: response(user), workspace: { id: workspace.id, title: workspace.title } }
}
