import Membership from '../models/Membership.js'
import User from '../models/User.js'
import Workspace from '../models/Workspace.js'
import { ROLE_OWNER } from '../constants/roles.js'
import { hash } from '../utils/password.js'

// The password hash never leaves this module through the normal response shape, so it
// cannot be returned by accident.
const response = (entry) => ({
  id: entry.id,
  email: entry.email,
  verified: entry.verified,
  created: entry.created,
  updated: entry.updated,
})

export const byEmail = (email) => User.findOne({ email: String(email).trim().toLowerCase() })

export const get = async (id) => {
  const entry = await User.findOne({ id })

  return entry == null ? null : response(entry)
}

/*
 * Creates a user together with a personal workspace.
 *
 * The workspace is always created, even for someone working alone: domains belong to a
 * workspace rather than to a user, so without one a new account would have nowhere to put
 * a domain. A single user never sees it — for them it is simply "my domains".
 */
export const add = async ({ email, password, verified = false, workspaceTitle }) => {
  const user = await User.create({
    email,
    password: await hash(password),
    verified,
  })

  const workspace = await Workspace.create({
    title: workspaceTitle ?? `${user.email}`,
  })

  await Membership.create({
    userId: user.id,
    workspaceId: workspace.id,
    role: ROLE_OWNER,
  })

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

  return entry == null ? null : response(entry)
}

// A user's workspaces and their role in each. Read on every API request, so it is one
// indexed query rather than a scan.
export const memberships = async (userId) => {
  const entries = await Membership.find({ userId }).lean()

  return entries.map((entry) => ({ workspaceId: entry.workspaceId, role: entry.role }))
}
