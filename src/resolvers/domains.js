import * as domains from '../database/domains.js'
import { getEventStore } from '../stores/index.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from '../utils/KnownError.js'
import messages from '../utils/messages.js'
import pipe from '../utils/pipe.js'
import { canEdit, workspaceIds } from '../utils/domainIds.js'

export default {
  Domain: {
    facts: (parent) => parent,
    statistics: (parent) => parent,
  },
  Query: {
    domain: pipe(requireAuth, (parent, { id }, { viewer }) => {
      // The limit is in the query, not a check afterwards: another workspace's domain is
      // not hidden, it simply does not exist for this viewer.
      return domains.get(id, workspaceIds(viewer))
    }),
    domains: pipe(requireAuth, (parent, args, { viewer }) => {
      return domains.all(workspaceIds(viewer))
    }),
  },
  Mutation: {
    createDomain: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      let entry

      // The workspace comes from the viewer. A personal one is created at registration,
      // so a new user always has somewhere to put a domain.
      const [workspaceId] = canEdit(viewer)

      if (workspaceId == null) throw new KnownError('No workspace to add a domain to')

      try {
        entry = await domains.add(input, workspaceId)
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      return {
        payload: entry,
        success: true,
      }
    }),
    updateDomain: pipe(requireAuth, blockDemoMode, async (parent, { id, input }, { viewer }) => {
      let entry

      try {
        entry = await domains.update(id, input, canEdit(viewer))
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      if (entry == null) {
        throw new KnownError('Unknown domain')
      }

      return {
        payload: entry,
        success: true,
      }
    }),
    rotateIngestKey: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      const entry = await domains.rotateIngestKey(id, canEdit(viewer))

      if (entry == null) throw new KnownError('Unknown domain')

      return {
        payload: entry,
        success: true,
      }
    }),
    deleteDomain: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      // Delete the domain first, and only wipe its records if it really belonged to the
      // viewer. Otherwise knowing an id would be enough to destroy someone else's data.
      const entry = await domains.del(id, canEdit(viewer))

      if (entry == null) throw new KnownError('Unknown domain')

      await getEventStore().deleteRecords(id)

      return {
        success: true,
      }
    }),
  },
}
