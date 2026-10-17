import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'

// The one place that decides access. Until workspaces can be created (ACKEE-12), everything
// lives in the default workspace.
export const can = (viewer, permission, workspaceId = DEFAULT_WORKSPACE_ID) => {
  return viewer.memberships.some(
    (membership) => membership.workspaceId === workspaceId && membership.permissions.includes(permission),
  )
}

// Workspaces where the viewer holds a permission.
export const workspacesWith = (viewer, permission) => {
  return viewer.memberships
    .filter((membership) => membership.permissions.includes(permission))
    .map((membership) => membership.workspaceId)
}
