import { DOMAINS_MANAGE, GTM_MANAGE, REPORTS_READ } from '../constants/permissions.js'
import * as auditLog from '../database/auditLog.js'
import * as geo from '../utils/geo.js'
import * as domains from '../database/domains.js'
import * as ga4 from '../database/ga4.js'
import * as records from '../database/records.js'
import * as rollups from '../database/rollups.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from '../utils/KnownError.js'
import { can, domainScope, workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

// The country is personal data, so it is the owner's decision, not an editor's (review of #71).
// The owner-only permission of #36 is reused: a new one would leave Role overrides without owners.
const COUNTRY_MANAGE = GTM_MANAGE

export default {
  Domain: {
    // The source travels with the domain to every report below (ACKEE-21)
    // So do the filters and the period of the dashboard (ACKEE-24)
    facts: (parent, { source, filters }) => ({ ...parent, source, filters }),
    statistics: (parent, { source, filters, period }) => ({ ...parent, source, filters, period }),
    canManageCountry: (parent, args, { viewer }) => can(viewer, COUNTRY_MANAGE, parent.workspaceId),
  },
  Query: {
    // The limit is in the query, not a check afterwards: another workspace's domain is not
    // hidden, it simply does not exist for this viewer.
    domain: pipe(requireAuth, (parent, { id }, { viewer }) => {
      return domains.get(id, domainScope(viewer, REPORTS_READ))
    }),
    domains: pipe(requireAuth, (parent, args, { viewer }) => {
      return domains.all(domainScope(viewer, REPORTS_READ))
    }),
    // No requireAuth: it says nothing about the data, only what the instance offers
    countryAvailable: () => geo.isEnabled(),
  },
  Mutation: {
    createDomain: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      // The first workspace where the viewer may add domains. Registration creates a
      // personal one, so a new user always has somewhere to put a domain.
      const [workspaceId] = workspacesWith(viewer, DOMAINS_MANAGE)

      if (workspaceId == null) throw new KnownError('You do not have permission to do this')

      const entry = await validated(domains.add(input, workspaceId))

      await auditLog.record(viewer, workspaceId, 'domain.create', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    updateDomain: pipe(requireAuth, blockDemoMode, async (parent, { id, input }, { viewer }) => {
      if (input.collectCountry != null) {
        const current = await domains.get(id, domainScope(viewer, DOMAINS_MANAGE))

        const changes = current != null && input.collectCountry !== (current.collectCountry === true)

        if (changes && can(viewer, COUNTRY_MANAGE, current.workspaceId) === false) {
          throw new KnownError('Only an owner can change the country of visitors')
        }
      }

      const entry = await validated(domains.update(id, input, domainScope(viewer, DOMAINS_MANAGE)))

      // The same answer for a domain that does not exist and one the viewer may not change.
      if (entry == null) throw new KnownError('Unknown domain')

      await auditLog.record(viewer, entry.workspaceId, 'domain.update', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    rotateIngestKey: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      const entry = await domains.rotateIngestKey(id, domainScope(viewer, DOMAINS_MANAGE))

      // The same answer for a domain that does not exist and one the viewer may not change.
      if (entry == null) throw new KnownError('Unknown domain')

      await auditLog.record(viewer, entry.workspaceId, 'domain.rotateIngestKey', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    deleteDomain: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      // Delete the domain first, and wipe its records only if it really was the viewer's to
      // delete. Otherwise knowing an id would be enough to destroy someone else's data.
      const entry = await domains.del(id, domainScope(viewer, DOMAINS_MANAGE))

      if (entry == null) throw new KnownError('Unknown domain')

      await records.del(id)
      await rollups.del(id)
      // The sealed key and the synced days go with the domain, and the sync stops asking for it
      await ga4.disconnect(id)
      await auditLog.record(viewer, entry.workspaceId, 'domain.delete', id)

      return {
        success: true,
      }
    }),
  },
}
