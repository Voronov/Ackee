import { getEventStore } from '../stores/index.js'
import * as events from '../database/events.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from '../utils/KnownError.js'
import messages from '../utils/messages.js'
import pipe from '../utils/pipe.js'
import { canEdit, workspaceIds } from '../utils/domainIds.js'

export default {
  Event: {
    statistics: (parent) => parent,
  },
  Query: {
    event: pipe(requireAuth, (parent, { id }, { viewer }) => {
      return events.get(id, workspaceIds(viewer))
    }),
    events: pipe(requireAuth, (parent, args, { viewer }) => {
      return events.all(workspaceIds(viewer))
    }),
  },
  Mutation: {
    createEvent: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      let entry

      try {
        const [workspaceId] = canEdit(viewer)

        if (workspaceId == null) throw new KnownError('No workspace to add an event to')

        entry = await events.add(input, workspaceId)
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
    updateEvent: pipe(requireAuth, blockDemoMode, async (parent, { id, input }, { viewer }) => {
      let entry

      try {
        entry = await events.update(id, input, canEdit(viewer))
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      if (entry == null) {
        throw new KnownError('Unknown event')
      }

      return {
        payload: entry,
        success: true,
      }
    }),
    deleteEvent: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      // Delete the event first, and only wipe its actions if it really belonged to the
      // viewer. Otherwise knowing an id would be enough to destroy someone else's data.
      const entry = await events.del(id, canEdit(viewer))

      if (entry == null) throw new KnownError('Unknown event')

      await getEventStore().deleteActions(id)

      return {
        success: true,
      }
    }),
  },
}
