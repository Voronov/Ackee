import { EVENTS_MANAGE, REPORTS_READ } from '../constants/permissions.js'
import * as actions from '../database/actions.js'
import * as auditLog from '../database/auditLog.js'
import * as events from '../database/events.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from '../utils/KnownError.js'
import { workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

export default {
  Event: {
    statistics: (parent) => parent,
  },
  Query: {
    // Limited in the query, like domains: another workspace's event does not exist here.
    event: pipe(requireAuth, (parent, { id }, { viewer }) => {
      return events.get(id, workspacesWith(viewer, REPORTS_READ))
    }),
    events: pipe(requireAuth, (parent, args, { viewer }) => {
      return events.all(workspacesWith(viewer, REPORTS_READ))
    }),
  },
  Mutation: {
    createEvent: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      const [workspaceId] = workspacesWith(viewer, EVENTS_MANAGE)

      if (workspaceId == null) throw new KnownError('You do not have permission to do this')

      const entry = await validated(events.add(input, workspaceId))

      await auditLog.record(viewer, workspaceId, 'event.create', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    updateEvent: pipe(requireAuth, blockDemoMode, async (parent, { id, input }, { viewer }) => {
      const entry = await validated(events.update(id, input, workspacesWith(viewer, EVENTS_MANAGE)))

      if (entry == null) throw new KnownError('Unknown event')

      await auditLog.record(viewer, entry.workspaceId, 'event.update', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    deleteEvent: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      // Delete the event first, and wipe its actions only if it really was the viewer's.
      const entry = await events.del(id, workspacesWith(viewer, EVENTS_MANAGE))

      if (entry == null) throw new KnownError('Unknown event')

      await actions.del(id)
      await auditLog.record(viewer, entry.workspaceId, 'event.delete', id)

      return {
        success: true,
      }
    }),
  },
}
