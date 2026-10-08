// Roles inside a workspace. Order matters: the position in the array is the rank, so
// "at least editor" is a comparison rather than a list of cases.
export const ROLE_VIEWER = 'VIEWER'
export const ROLE_EDITOR = 'EDITOR'
export const ROLE_OWNER = 'OWNER'

export const ROLES = [ROLE_VIEWER, ROLE_EDITOR, ROLE_OWNER]

export const isAtLeast = (role, required) => ROLES.indexOf(role) >= ROLES.indexOf(required)
