import { DOMAINS_MANAGE, GTM_MANAGE } from '../constants/permissions.js'
import * as auditLog from '../database/auditLog.js'
import * as tracking from '../database/tracking.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import Domain from '../models/Domain.js'
import KnownError from '../utils/KnownError.js'
import { can, workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'

export default {
  Domain: {
    // The domain itself was already filtered by the viewer's workspaces in the domain query
    tracking: async (parent) => tracking.of(await Domain.findOne({ id: parent.id }).lean()),
  },
  Mutation: {
    updateDomainTracking: pipe(requireAuth, blockDemoMode, async (parent, { id, input }, { viewer }) => {
      const within = { workspaceId: { $in: workspacesWith(viewer, DOMAINS_MANAGE) } }
      const current = await Domain.findOne({ id, ...within }).lean()

      // The same answer for a domain that does not exist and one the viewer may not change
      if (current == null) throw new KnownError('Unknown domain')

      // A container runs any code of its owner on the site, so it takes more than editing the
      // domain (review of #36), and both ids go into the log
      const previousGtm = tracking.of(current).gtmId
      const nextGtm = input.gtmId ?? ''
      const gtmChanges = nextGtm !== previousGtm

      if (gtmChanges && can(viewer, GTM_MANAGE, current.workspaceId) === false) {
        throw new KnownError('Only an owner can set the Tag Manager container')
      }

      const result = await tracking.update(id, input, within)

      if (typeof result === 'string') throw new KnownError(result)
      if (result == null) throw new KnownError('Unknown domain')

      await auditLog.record(viewer, result.domain.workspaceId, 'domain.tracking', id)
      if (gtmChanges) {
        await auditLog.record(
          viewer,
          result.domain.workspaceId,
          'domain.gtm',
          id,
          `${previousGtm || 'none'} → ${nextGtm}`,
        )
      }

      return { success: true, payload: result.tracking }
    }),
  },
}
