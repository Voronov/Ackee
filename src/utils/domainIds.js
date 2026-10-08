import debouncePromise from 'debounce-promise'

import * as domains from '../database/domains.js'
import { ROLE_OWNER, ROLE_EDITOR, isAtLeast } from '../constants/roles.js'

// The viewer's workspaces where they hold at least the given role.
export const workspaceIds = (viewer, minimumRole) =>
  viewer.memberships
    .filter((membership) => minimumRole == null || isAtLeast(membership.role, minimumRole))
    .map((membership) => membership.workspaceId)

export const canEdit = (viewer) => workspaceIds(viewer, ROLE_EDITOR)
export const canOwn = (viewer) => workspaceIds(viewer, ROLE_OWNER)

// A zero timeout is enough to ensure that this task
// runs only once on every API call. It's a task that would
// otherwise execute multiple times.
const loadDomains = debouncePromise(domains.all, 0)

export default async (domain) => {
  if (domain.id == null) {
    const allDomains = await loadDomains()
    return allDomains.map((domain) => domain.id)
  }

  return [domain.id]
}
