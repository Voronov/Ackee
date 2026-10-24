import { DOMAINS_MANAGE } from '../constants/permissions.js'
import { GA4_PROPERTY_ID } from '../constants/ga4.js'
import * as auditLog from '../database/auditLog.js'
import * as domains from '../database/domains.js'
import * as ga4 from '../database/ga4.js'
import { syncConnection } from '../ga4/sync.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import Ga4Connection from '../models/Ga4Connection.js'
import KnownError from '../utils/KnownError.js'
import { workspacesWith } from '../utils/permissions.js'
import pipe from '../utils/pipe.js'
import { isEnabled as canSeal } from '../utils/secretBox.js'
import signale from '../utils/signale.js'

// The same answer for a domain that does not exist and one the viewer may not change
const managed = async (viewer, domainId) => {
  const domain = await domains.get(domainId, workspacesWith(viewer, DOMAINS_MANAGE))
  if (domain == null) throw new KnownError('Unknown domain')
  return domain
}

// The first sync of a new connection can take minutes, so it runs after the answer
const syncLater = (domainId) =>
  Ga4Connection.findOne({ domainId }).then((entry) =>
    syncConnection(entry).catch((error) => signale.warn(`GA4 sync of domain ${domainId} failed: ${error.message}`)),
  )

export default {
  Domain: {
    ga4: (parent) => ga4.get(parent.id),
  },
  Query: {
    ga4Available: () => canSeal(),
  },
  Mutation: {
    connectGa4: pipe(requireAuth, blockDemoMode, async (parent, { domainId, input }, { viewer }) => {
      const domain = await managed(viewer, domainId)

      if (canSeal() === false)
        throw new KnownError('Set ACKEE_SECRET_KEY on the server before connecting Google Analytics')

      const propertyId = String(input.propertyId ?? '').trim()
      if (GA4_PROPERTY_ID.test(propertyId) === false)
        throw new KnownError('A GA4 property id is a number, like 123456789')

      const account = ga4.parseKey(input.key)
      if (account == null)
        throw new KnownError('Paste the whole JSON key of a service account, as Google Cloud downloads it')

      try {
        await ga4.check(account, propertyId)
      } catch (error) {
        throw new KnownError(
          `Google Analytics refused: ${error.message}. Add ${account.clientEmail} as a Viewer of the property.`,
        )
      }

      await ga4.connect(domain.id, propertyId, account)
      await auditLog.record(viewer, domain.workspaceId, 'domain.ga4.connect', domain.id)
      syncLater(domain.id)

      return { success: true, payload: await ga4.get(domain.id) }
    }),
    disconnectGa4: pipe(requireAuth, blockDemoMode, async (parent, { domainId }, { viewer }) => {
      const domain = await managed(viewer, domainId)

      await ga4.disconnect(domain.id)
      await auditLog.record(viewer, domain.workspaceId, 'domain.ga4.disconnect', domain.id)

      return { success: true }
    }),
    syncGa4: pipe(requireAuth, blockDemoMode, async (parent, { domainId }, { viewer }) => {
      const domain = await managed(viewer, domainId)
      const entry = await Ga4Connection.findOne({ domainId: domain.id })
      if (entry == null) throw new KnownError('This domain is not connected to Google Analytics')

      try {
        await syncConnection(entry)
      } catch (error) {
        throw new KnownError(`The sync failed: ${error.message}`)
      }

      return { success: true, payload: await ga4.get(domain.id) }
    }),
  },
}
