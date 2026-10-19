import { ROLE_OWNER } from '../constants/roles.js'
import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import Membership from '../models/Membership.js'
import PermanentToken from '../models/PermanentToken.js'
import User from '../models/User.js'
import Workspace from '../models/Workspace.js'
import { hash } from '../utils/password.js'

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

// Adds a user to a workspace. A member who is there already gets the new role and domains:
// the newest invitation is what the owner meant.
export const join = async (userId, workspaceId, { role, domainIds }) => {
  const entry = await Membership.findOneAndUpdate(
    { userId, workspaceId },
    { $set: { role, domainIds } },
    { upsert: true, returnDocument: 'after' },
  )

  return member(entry, await User.findOne({ id: userId }).lean())
}

// Removes a member. The last owner stays: a workspace without one could never be managed again.
export const leave = async (id, workspaceIds) => {
  const entry = await Membership.findOne({ id, workspaceId: { $in: workspaceIds } }).lean()

  if (entry == null) return { status: 'UNKNOWN' }

  if (entry.role === ROLE_OWNER) {
    const owners = await Membership.countDocuments({ workspaceId: entry.workspaceId, role: ROLE_OWNER })

    if (owners <= 1) return { status: 'LAST_OWNER' }
  }

  await Membership.deleteOne({ id })

  return { status: 'OK', member: member(entry, await User.findOne({ id: entry.userId }).lean()) }
}
