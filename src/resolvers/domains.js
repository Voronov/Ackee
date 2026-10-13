import * as auditLog from '../database/auditLog.js'
import * as domains from '../database/domains.js'
import * as records from '../database/records.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import requirePermission from '../middlewares/requirePermission.js'
import { DOMAINS_MANAGE, REPORTS_READ } from '../constants/permissions.js'
import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import KnownError from '../utils/KnownError.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

// The workspace a domain lives in. An unknown domain falls through to the resolver's own error.
const workspaceOfDomain = async (parent, { id }) => (await domains.get(id))?.workspaceId ?? DEFAULT_WORKSPACE_ID

export default {
  Domain: {
    facts: (parent) => parent,
    statistics: (parent) => parent,
  },
  Query: {
    domain: pipe(requireAuth, requirePermission(REPORTS_READ, workspaceOfDomain), (parent, { id }) => {
      return domains.get(id)
    }),
    domains: pipe(requireAuth, requirePermission(REPORTS_READ), () => {
      return domains.all()
    }),
  },
  Mutation: {
    createDomain: pipe(
      requireAuth,
      requirePermission(DOMAINS_MANAGE),
      blockDemoMode,
      async (parent, { input }, { viewer }) => {
        const entry = await validated(domains.add(input))

        await auditLog.record(viewer, entry.workspaceId, 'domain.create', entry.id)

        return {
          payload: entry,
          success: true,
        }
      },
    ),
    updateDomain: pipe(
      requireAuth,
      requirePermission(DOMAINS_MANAGE, workspaceOfDomain),
      blockDemoMode,
      async (parent, { id, input }, { viewer }) => {
        const entry = await validated(domains.update(id, input))

        if (entry == null) {
          throw new KnownError('Unknown domain')
        }

        await auditLog.record(viewer, entry.workspaceId, 'domain.update', entry.id)

        return {
          payload: entry,
          success: true,
        }
      },
    ),
    deleteDomain: pipe(
      requireAuth,
      requirePermission(DOMAINS_MANAGE, workspaceOfDomain),
      blockDemoMode,
      async (parent, { id }, { viewer }) => {
        const workspaceId = await workspaceOfDomain(parent, { id })

        await records.del(id)
        await domains.del(id)
        await auditLog.record(viewer, workspaceId, 'domain.delete', id)

        return {
          success: true,
        }
      },
    ),
  },
}
