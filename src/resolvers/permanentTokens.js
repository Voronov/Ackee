import * as auditLog from '../database/auditLog.js'
import * as permanentTokens from '../database/permanentTokens.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import requirePermission from '../middlewares/requirePermission.js'
import { TOKENS_MANAGE } from '../constants/permissions.js'
import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import KnownError from '../utils/KnownError.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

export default {
  Query: {
    permanentToken: pipe(requireAuth, requirePermission(TOKENS_MANAGE), (parent, { id }) => {
      return permanentTokens.get(id)
    }),
    permanentTokens: pipe(requireAuth, requirePermission(TOKENS_MANAGE), () => {
      return permanentTokens.all()
    }),
  },
  Mutation: {
    createPermanentToken: pipe(
      requireAuth,
      requirePermission(TOKENS_MANAGE),
      blockDemoMode,
      async (parent, { input }, { viewer }) => {
        // The owner comes from the viewer, so a token cannot be created in someone else's name.
        const entry = await validated(permanentTokens.add({ title: input.title, userId: viewer.userId }))

        await auditLog.record(viewer, DEFAULT_WORKSPACE_ID, 'token.create', entry.id)

        return {
          payload: entry,
          success: true,
        }
      },
    ),
    updatePermanentToken: pipe(
      requireAuth,
      requirePermission(TOKENS_MANAGE),
      blockDemoMode,
      async (parent, { id, input }, { viewer }) => {
        const entry = await validated(permanentTokens.update(id, input))

        if (entry == null) {
          throw new KnownError('Unknown domain')
        }

        await auditLog.record(viewer, DEFAULT_WORKSPACE_ID, 'token.update', entry.id)

        return {
          payload: entry,
          success: true,
        }
      },
    ),
    deletePermanentToken: pipe(
      requireAuth,
      requirePermission(TOKENS_MANAGE),
      blockDemoMode,
      async (parent, { id }, { viewer }) => {
        await permanentTokens.del(id)
        await auditLog.record(viewer, DEFAULT_WORKSPACE_ID, 'token.delete', id)

        return {
          success: true,
        }
      },
    ),
  },
}
