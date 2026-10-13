import { REPORTS_READ } from '../constants/permissions.js'
import * as domains from '../database/domains.js'
import { workspacesWith } from './permissions.js'

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

  viewer.allDomainIds ??= domains
    .all(workspacesWith(viewer, REPORTS_READ))
    .then((entries) => entries.map((entry) => entry.id))

  return viewer.allDomainIds
}
