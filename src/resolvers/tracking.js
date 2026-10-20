import { DOMAINS_MANAGE } from '../constants/permissions.js'
import * as auditLog from '../database/auditLog.js'
import * as tracking from '../database/tracking.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import Domain from '../models/Domain.js'
import KnownError from '../utils/KnownError.js'
import { workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'

export default {
  Domain: {
    // The domain itself was already filtered by the viewer's workspaces in the domain query
    tracking: async (parent) => tracking.of(await Domain.findOne({ id: parent.id }).lean()),
  },
  Mutation: {
    updateDomainTracking: pipe(requireAuth, blockDemoMode, async (parent, { id, input }, { viewer }) => {
      const result = await tracking.update(id, input, { workspaceId: { $in: workspacesWith(viewer, DOMAINS_MANAGE) } })

      if (typeof result === 'string') throw new KnownError(result)
      // The same answer for a domain that does not exist and one the viewer may not change
      if (result == null) throw new KnownError('Unknown domain')

      await auditLog.record(viewer, result.domain.workspaceId, 'domain.tracking', id)

      return { success: true, payload: result.tracking }
    }),
  },
}
