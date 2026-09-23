import * as domains from '../database/domains.js'
import * as records from '../database/records.js'
import { enqueue } from '../queue/redis.js'
import { getEventStore } from '../stores/index.js'
import { usesQueue } from '../utils/config.js'
import countryOf from '../utils/geo.js'
import { recordsCreated } from '../utils/metrics.js'
import matchesOrigin from '../utils/matchesOrigin.js'
import identifier from '../utils/identifier.js'
import KnownError from '../utils/KnownError.js'
import messages from '../utils/messages.js'
import normalizeUrl from '../utils/normalizeUrl.js'

const normalizeSiteLocation = (siteLocation) => {
  if (siteLocation == null) {
    // Pre-validate siteLocation and imitate MongoDB error
    throw new KnownError(`Path \`siteLocation\` is required`)
  }

  try {
    return normalizeUrl(siteLocation.toString())
  } catch (error) {
    throw new KnownError(`Failed to normalize \`siteLocation\``, error)
  }
}

const normalizeSiteReferrer = (siteReferrer) => {
  // The siteReferrer is optional
  if (siteReferrer == null) return siteReferrer

  try {
    return normalizeUrl(siteReferrer.toString())
  } catch (error) {
    throw new KnownError(`Failed to normalize \`siteReferrer\``, error)
  }
}

const polish = (obj) => {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    value = typeof value === 'string' ? value.trim() : value
    value = value == null ? undefined : value
    value = value === '' ? undefined : value

    if (key === 'siteLocation') value = normalizeSiteLocation(value)
    if (key === 'siteReferrer') value = normalizeSiteReferrer(value)

    acc[key] = value
    return acc
  }, {})
}

export default {
  Mutation: {
    createRecord: async (parent, { domainId, input }, { ip, userAgent, isIgnored, ingestKey, origin }) => {
      // Ignore your own records when logged in
      if (isIgnored === true) {
        return {
          success: true,
          payload: {
            // Sentinel UUID returned for ignored (own) visits so the tracker
            // receives a valid-looking response without persisting real data.
            // This value is stable and matched in tests.
            id: '88888888-8888-8888-8888-888888888888',
          },
        }
      }

      // The key may arrive two ways. A custom integration can send a header, but the
      // bundled tracker passes the domain id straight through and sets no headers of its
      // own, so the snippet carries "<id>.<key>" and the server splits it here. A dot
      // appears in neither a UUID nor a base64url key, so the split is unambiguous.
      const [id, keyFromId] = String(domainId).split('.')
      const key = ingestKey ?? keyFromId

      // Tracking is unauthenticated, so the domain is looked up without a workspace filter.
      const domain = await domains.getUnscoped(id)

      if (domain == null) throw new KnownError('Unknown domain')

      // The key is not a secret: it sits in the snippet on a public page. What it stops is
      // the easy case, someone reading a domain id out of a site's source and pointing
      // their own traffic at it. Strict mode is off until the owner turns it on, so an
      // existing snippet keeps working.
      if (domain.strictIngest === true) {
        if (key !== domain.ingestKey) throw new KnownError('Ingest key missing or wrong')
        if (matchesOrigin(origin, domain.title) === false) throw new KnownError('Origin does not match the domain')
      }

      const clientId = identifier(ip, userAgent, domain.id)

      // The country is resolved here because this is the last place the IP exists. Only
      // the country code travels any further.
      const country = countryOf(ip)

      const data = polish({ ...input, clientId, country, domainId: domain.id })

      // With the queue the tracker gets the same answer, but from the validated, not yet
      // saved record: the worker creates it later with this id and these dates
      if (usesQueue() === true) {
        let validated

        try {
          validated = await records.validate(data)
        } catch (error) {
          if (error.name === 'ValidationError') {
            throw new KnownError(messages(error.errors))
          }

          throw error
        }

        await enqueue('record.create', { ...data, ...validated })
        recordsCreated.inc()

        return {
          success: true,
          payload: validated,
        }
      }

      const store = getEventStore()

      let entry

      try {
        entry = await store.addRecord(data)
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      recordsCreated.inc()

      // Anonymize old entries with the same clientId to prevent that the browsing history
      // of a user is reconstructible. Will be skipped when there're no previous entries.
      await store.anonymize(clientId, entry.id)

      return {
        success: true,
        payload: entry,
      }
    },
    updateRecord: async (parent, { id }, { isIgnored }) => {
      // Ignore your own records when logged in
      if (isIgnored === true) {
        return {
          success: true,
        }
      }

      if (usesQueue() === true) {
        await enqueue('record.touch', { id, updated: Date.now() })

        return {
          success: true,
        }
      }

      let entry

      try {
        entry = await getEventStore().touchRecord(id)
      } catch (error) {
        if (error.name === 'ValidationError') {
          throw new KnownError(messages(error.errors))
        }

        throw error
      }

      if (entry == null) {
        throw new KnownError('Unknown record')
      }

      return {
        success: true,
      }
    },
  },
}
