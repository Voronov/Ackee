import { TOKENS_MANAGE } from '../constants/permissions.js'
import * as auditLog from '../database/auditLog.js'
import * as permanentTokens from '../database/permanentTokens.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import requirePermission from '../middlewares/requirePermission.js'
import KnownError from '../utils/KnownError.js'
import { workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

// An API token acts as its owner, so it belongs to a user, not a workspace. The right to
// hold one comes from any workspace where the viewer may manage tokens.
const tokenWorkspace = (parent, args, { viewer }) => workspacesWith(viewer, TOKENS_MANAGE)[0]

const requireTokens = requirePermission(TOKENS_MANAGE, tokenWorkspace)

export default {
  Query: {
    // Only the viewer's own tokens: a token id is the secret itself.
    permanentToken: pipe(requireAuth, requireTokens, (parent, { id }, { viewer }) => {
      return permanentTokens.get(id, viewer.userId)
    }),
    permanentTokens: pipe(requireAuth, requireTokens, (parent, args, { viewer }) => {
      return permanentTokens.all(viewer.userId)
    }),
  },
  Mutation: {
    createPermanentToken: pipe(requireAuth, requireTokens, blockDemoMode, async (parent, { input }, context) => {
      const { viewer } = context

      // The owner comes from the viewer, so a token cannot be created in someone else's name.
      const entry = await validated(permanentTokens.add({ title: input.title, userId: viewer.userId }))

      await auditLog.record(viewer, tokenWorkspace(parent, {}, context), 'token.create', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    updatePermanentToken: pipe(requireAuth, requireTokens, blockDemoMode, async (parent, { id, input }, context) => {
      const { viewer } = context
      const entry = await validated(permanentTokens.update(id, input, viewer.userId))

      if (entry == null) {
        throw new KnownError('Unknown token')
      }

      await auditLog.record(viewer, tokenWorkspace(parent, {}, context), 'token.update', entry.id)

      return {
        payload: entry,
        success: true,
      }
    }),
    deletePermanentToken: pipe(requireAuth, requireTokens, blockDemoMode, async (parent, { id }, context) => {
      const { viewer } = context
      const entry = await permanentTokens.del(id, viewer.userId)

      if (entry == null) throw new KnownError('Unknown token')

      await auditLog.record(viewer, tokenWorkspace(parent, {}, context), 'token.delete', id)

      return {
        success: true,
      }
    }),
  },
}
