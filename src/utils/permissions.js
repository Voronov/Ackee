import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'

// A membership limited to some domains (ACKEE-16) gives nothing workspace-wide: no events,
// no tokens, no new domains. Its domains are handed out by `domainScope` alone.
const unrestricted = (membership) => (membership.domainIds ?? []).length === 0

const holding = (viewer, permission) =>
  viewer.memberships.filter((membership) => membership.permissions.includes(permission))

// The one place that decides access. Until workspaces can be created (ACKEE-12), everything
// lives in the default workspace.
export const can = (viewer, permission, workspaceId = DEFAULT_WORKSPACE_ID) => {
  return holding(viewer, permission).some(
    (membership) => membership.workspaceId === workspaceId && unrestricted(membership),
  )
}

// Workspaces where the viewer holds a permission.
export const workspacesWith = (viewer, permission) => {
  return holding(viewer, permission)
    .filter(unrestricted)
    .map((membership) => membership.workspaceId)
}

// Where the viewer may act on domains: whole workspaces, plus the single domains of the
// workspaces where the membership is limited. database/domains.js turns it into a filter.
export const domainScope = (viewer, permission) => ({
  workspaces: workspacesWith(viewer, permission),
  domains: holding(viewer, permission)
    .filter((membership) => unrestricted(membership) === false)
    .flatMap((membership) => membership.domainIds),
})
