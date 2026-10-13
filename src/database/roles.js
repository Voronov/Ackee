import { BUILT_IN_ROLES } from '../constants/roles.js'
import Role from '../models/Role.js'

// Permissions per role name. Stored roles win over built-in ones; an unknown role grants nothing.
export const permissionsFor = async (names) => {
  const stored = await Role.find({ name: { $in: names } }).lean()
  const byName = Object.fromEntries(stored.map((role) => [role.name, role.permissions]))

  return Object.fromEntries(names.map((name) => [name, byName[name] ?? BUILT_IN_ROLES[name] ?? []]))
}
