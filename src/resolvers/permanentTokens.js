import * as permanentTokens from '../database/permanentTokens.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from '../utils/KnownError.js'
import pipe from '../utils/pipe.js'
import validated from '../utils/validated.js'

export default {
  Query: {
    permanentToken: pipe(requireAuth, (parent, { id }) => {
      return permanentTokens.get(id)
    }),
    permanentTokens: pipe(requireAuth, () => {
      return permanentTokens.all()
    }),
  },
  Mutation: {
    createPermanentToken: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      // The owner comes from the viewer, so a token cannot be created in someone else's name.
      const entry = await validated(permanentTokens.add({ title: input.title, userId: viewer.userId }))

      return {
        payload: entry,
        success: true,
      }
    }),
    updatePermanentToken: pipe(requireAuth, blockDemoMode, async (parent, { id, input }) => {
      const entry = await validated(permanentTokens.update(id, input))

      if (entry == null) {
        throw new KnownError('Unknown domain')
      }

      return {
        payload: entry,
        success: true,
      }
    }),
    deletePermanentToken: pipe(requireAuth, blockDemoMode, async (parent, { id }) => {
      await permanentTokens.del(id)

      return {
        success: true,
      }
    }),
  },
}
