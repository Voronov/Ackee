import * as connections from '../database/gaConnections.js'
import * as domains from '../database/domains.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import { check } from '../import/ga4Api.js'
import { canEdit, workspaceIds } from '../utils/domainIds.js'
import { isEnabled as secretsEnabled } from '../utils/secrets.js'
import KnownError from '../utils/KnownError.js'
import pipe from '../utils/pipe.js'

// A service account key is a real credential, so it is never stored unencrypted. Without
// ACKEE_SECRET there is nothing to encrypt it with, and the feature says so rather than
// storing it in the clear.
const requireSecret = () => {
  if (secretsEnabled() === false) {
    throw new KnownError('Set ACKEE_SECRET before connecting an Analytics property')
  }
}

export default {
  Query: {
    gaConnection: pipe(requireAuth, (parent, { domainId }, { viewer }) => {
      return connections.forDomain(domainId, workspaceIds(viewer))
    }),
  },
  Mutation: {
    createGaConnection: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      requireSecret()

      const allowed = canEdit(viewer)
      const domain = await domains.get(input.domainId, allowed)

      if (domain == null) throw new KnownError('Unknown domain')

      let credentials

      try {
        credentials = JSON.parse(input.credentials)
      } catch {
        throw new KnownError('The key is not valid JSON. Paste the whole file you downloaded.')
      }

      if (credentials.client_email == null || credentials.private_key == null) {
        throw new KnownError('That looks like the wrong file. A service account key has client_email and private_key.')
      }

      // Checked against the property now, so a key that was never granted access fails
      // here rather than quietly at four in the morning.
      try {
        await check(credentials, input.propertyId)
      } catch (error) {
        throw new KnownError(`Analytics refused the key: ${error.message}`)
      }

      if ((await connections.forDomain(input.domainId, allowed)) != null) {
        throw new KnownError('This domain is already connected. Disconnect it first.')
      }

      return {
        success: true,
        payload: await connections.add({ ...input, credentials }, domain.workspaceId),
      }
    }),
    deleteGaConnection: pipe(requireAuth, blockDemoMode, async (parent, { domainId }, { viewer }) => {
      const entry = await connections.del(domainId, canEdit(viewer))

      if (entry == null) throw new KnownError('Unknown connection')

      return { success: true }
    }),
  },
}
