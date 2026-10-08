import * as permanentTokens from '../database/permanentTokens.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import KnownError from '../utils/KnownError.js'
import messages from '../utils/messages.js'
import pipe from '../utils/pipe.js'

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
      let entry

      try {
        // The owner comes from the viewer, not from the input, or a token could be
        // created in someone else's name.
        entry = await permanentTokens.add({ ...input, userId: viewer.userId })
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
    updatePermanentToken: pipe(requireAuth, blockDemoMode, async (parent, { id, input }) => {
      let entry

      try {
        entry = await permanentTokens.update(id, input)
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
    deletePermanentToken: pipe(requireAuth, blockDemoMode, async (parent, { id }) => {
      await permanentTokens.del(id)

      return {
        success: true,
      }
    }),
  },
}
