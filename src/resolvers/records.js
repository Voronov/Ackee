import { randomUUID as uuid } from 'node:crypto'

import * as domains from '../database/domains.js'
import * as records from '../database/records.js'
import { recordCreate, recordTouch } from '../queue/messages.js'
import * as ingestQueue from '../queue/redis.js'
import matchesOrigin from '../utils/matchesOrigin.js'
import identifier from '../utils/identifier.js'
import KnownError from '../utils/KnownError.js'
import normalizeUrl from '../utils/normalizeUrl.js'
import validated from '../utils/validated.js'

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

// With the queue the tracker must not wait for MongoDB, so domains come from a cache. Without
// it every view reads the domain, as before.
const findDomain = (id) => (ingestQueue.isEnabled() === true ? domains.getUnscopedCached(id) : domains.getUnscoped(id))

const store = async (data) => {
  const entry = await validated(records.add(data))

  // Anonymize old entries with the same clientId to prevent that the browsing history
  // of a user is reconstructible. Will be skipped when there're no previous entries.
  await records.anonymize(data.clientId, entry.id)

  return entry
}

// The tracker is answered with the id and the dates the worker will store (ADR-006). When the
// queue cannot take the event, it is written at once the way the worker writes it: the worker
// may already have stored a newer view of the visitor, or this one through a late XADD.
const enqueueRecord = async (data) => {
  const now = new Date()
  const record = { ...data, id: uuid(), created: now, updated: now }
  const entry = await validated(records.validate(record))

  if ((await ingestQueue.enqueue(recordCreate(record))) === false) await validated(records.addOnce(record))

  return entry
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
      const domain = await findDomain(id)

      if (domain == null) throw new KnownError('Unknown domain')

      // The key is not a secret: it sits in the snippet on a public page. What it stops is
      // the easy case, someone reading a domain id out of a site's source and pointing
      // their own traffic at it. Strict mode is off until the owner turns it on, so an
      // existing snippet keeps working.
      if (domain.strictIngest === true) {
        if (key !== domain.ingestKey) throw new KnownError('Ingest key missing or wrong')
        if (matchesOrigin(origin, domain.title) === false) throw new KnownError('Origin does not match the domain')
      }

      const clientId = await identifier(ip, userAgent, domain.id)
      const data = polish({ ...input, clientId, domainId: domain.id })

      const entry = ingestQueue.isEnabled() === true ? await enqueueRecord(data) : await store(data)

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

      if (ingestQueue.isEnabled() === true) {
        const now = new Date()

        // Whether the record exists is up to the worker: its create may still wait in the
        // queue. For the same reason a direct write that finds nothing is not an error here.
        if ((await ingestQueue.enqueue(recordTouch(id, now))) === false) await validated(records.update(id, now))

        return {
          success: true,
        }
      }

      const entry = await validated(records.update(id))

      if (entry == null) {
        throw new KnownError('Unknown record')
      }

      return {
        success: true,
      }
    },
  },
}
