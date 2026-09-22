import * as domains from '../database/domains.js'
import { ROLE_OWNER, ROLE_EDITOR, isAtLeast } from '../constants/roles.js'

// The viewer's workspaces where they hold at least the given role.
export const workspaceIds = (viewer, minimumRole) =>
  viewer.memberships
    .filter((membership) => minimumRole == null || isAtLeast(membership.role, minimumRole))
    .map((membership) => membership.workspaceId)

export const canEdit = (viewer) => workspaceIds(viewer, ROLE_EDITOR)
export const canOwn = (viewer) => workspaceIds(viewer, ROLE_OWNER)

/*
 * The domains a viewer may read.
 *
 * Every report goes through here: each statistics and facts resolver starts with this
 * call. That is why the limit lives here — missing it in one resolver out of twenty
 * would be far too easy.
 *
 * The result is cached on the viewer, which is built per request, so the cache lives
 * exactly as long as the request. The earlier version used `debouncePromise`, which
 * returns the same promise to every caller within a tick regardless of its arguments.
 * With workspaces that would hand one user another user's domains.
 */
export default (domain, viewer) => {
  if (domain.id != null) return Promise.resolve([domain.id])

  viewer.allDomainIds ??= domains.all(workspaceIds(viewer)).then((entries) => entries.map((entry) => entry.id))

  return viewer.allDomainIds
}
