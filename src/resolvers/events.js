import * as actions from '../database/actions.js'
import * as auditLog from '../database/auditLog.js'
import * as events from '../database/events.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import requirePermission from '../middlewares/requirePermission.js'
import { EVENTS_MANAGE, REPORTS_READ } from '../constants/permissions.js'
import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import KnownError from '../utils/KnownError.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

export default {
  Event: {
    statistics: (parent) => parent,
  },
  Query: {
    event: pipe(requireAuth, requirePermission(REPORTS_READ), (parent, { id }) => {
      return events.get(id)
    }),
    events: pipe(requireAuth, requirePermission(REPORTS_READ), () => {
      return events.all()
    }),
  },
  Mutation: {
    createEvent: pipe(
      requireAuth,
      requirePermission(EVENTS_MANAGE),
      blockDemoMode,
      async (parent, { input }, { viewer }) => {
        const entry = await validated(events.add(input))

        // Events have no workspace of their own yet (ACKEE-12).
        await auditLog.record(viewer, DEFAULT_WORKSPACE_ID, 'event.create', entry.id)

        return {
          payload: entry,
          success: true,
        }
      },
    ),
    updateEvent: pipe(
      requireAuth,
      requirePermission(EVENTS_MANAGE),
      blockDemoMode,
      async (parent, { id, input }, { viewer }) => {
        const entry = await validated(events.update(id, input))

        if (entry == null) {
          throw new KnownError('Unknown event')
        }

        await auditLog.record(viewer, DEFAULT_WORKSPACE_ID, 'event.update', entry.id)

        return {
          payload: entry,
          success: true,
        }
      },
    ),
    deleteEvent: pipe(
      requireAuth,
      requirePermission(EVENTS_MANAGE),
      blockDemoMode,
      async (parent, { id }, { viewer }) => {
        await actions.del(id)
        await events.del(id)
        await auditLog.record(viewer, DEFAULT_WORKSPACE_ID, 'event.delete', id)

        return {
          success: true,
        }
      },
    ),
  },
}
