import { ROLE_OWNER } from '../constants/roles.js'
import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import Membership from '../models/Membership.js'
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

  return entries.map((entry) => ({ workspaceId: entry.workspaceId, role: entry.role }))
}
