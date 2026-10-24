import { REPORTS_READ } from '../constants/permissions.js'
import * as domains from '../database/domains.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from './KnownError.js'
import { domainScope } from './permissions.js'

/*
 * The parent of the top-level `statistics` and `facts`: all domains of the viewer, or the one
 * picked on the dashboard (ACKEE-81).
 *
 * domainIds.js trusts an id on the parent, because `domain(id)` has checked it already. Here
 * the id comes straight from the request, so it is checked the same way first. A domain the
 * viewer may not read gets the same answer as one that does not exist.
 */
export default async (parent, { domainId }, context) => {
  if (domainId == null) return {}

  requireAuth(parent, {}, context)

  const entry = await domains.get(domainId, domainScope(context.viewer, REPORTS_READ))

  if (entry == null) throw new KnownError('Unknown domain')

  return { id: entry.id }
}
