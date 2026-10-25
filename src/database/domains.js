import { randomBytes } from 'node:crypto'

import { INGEST_DOMAIN_TTL } from '../constants/ingest.js'
import Domain from '../models/Domain.js'
import cachedLookup from '../utils/cachedLookup.js'
import KnownError from '../utils/KnownError.js'
import sortByProperty from '../utils/sortByProperty.js'

const newIngestKey = () => randomBytes(16).toString('base64url')

// Domains from before keys get theirs on first read, stored at once, so the snippet the
// owner copies always matches what the server checks.
const withIngestKey = async (entry) => {
  if (entry == null || entry.ingestKey != null) return entry

  return (
    (await Domain.findOneAndUpdate(
      { id: entry.id, ingestKey: { $exists: false } },
      { $set: { ingestKey: newIngestKey() } },
      { returnDocument: 'after' },
    )) ?? Domain.findOne({ id: entry.id })
  )
}

const response = (entry) => ({
  id: entry.id,
  title: entry.title,
  ingestKey: entry.ingestKey,
  strictIngest: entry.strictIngest,
  workspaceId: entry.workspaceId,
  created: entry.created,
  updated: entry.updated,
})

// The workspace filter belongs in the query, not in a check after reading. A forgotten
// check returns someone else's data; a forgotten filter returns nothing, which shows up
// at once.
// The scope is a list of workspaces or, from domainScope in utils/permissions.js, whole workspaces
// plus the single domains a member is limited to.
const within = (scope) =>
  Array.isArray(scope)
    ? { workspaceId: { $in: scope } }
    : { $or: [{ workspaceId: { $in: scope.workspaces } }, { id: { $in: scope.domains } }] }

// The ingest path reads domains from here while the ingest queue is on (ADR-006), so the
// tracker does not wait for MongoDB. Every change below forgets the domain, so in this
// process a rotated key, strict mode or a new title applies at once; other processes see it
// within INGEST_DOMAIN_TTL. getUnscoped is defined further down.
const cachedUnscoped = cachedLookup((id) => getUnscoped(id), INGEST_DOMAIN_TTL)
const forgetCached = (id) => cachedUnscoped.forget(id)

// Two domains of a workspace with one title cannot be told apart in the lists and in the
// select of the overview. The case does not tell them apart either.
const titleTaken = (workspaceId, title, exceptId) =>
  Domain.exists({ workspaceId, title: title.trim(), ...(exceptId == null ? {} : { id: { $ne: exceptId } }) }).collation(
    {
      locale: 'en',
      strength: 2,
    },
  )

const TITLE_TAKEN = 'A domain with this title already exists'

export const add = async (data, workspaceId) => {
  if ((await titleTaken(workspaceId, data.title)) != null) throw new KnownError(TITLE_TAKEN)

  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Domain.create({
      title: data.title,
      ingestKey: newIngestKey(),
      // A new domain's snippet carries the key from the start, so it can be strict at once.
      strictIngest: true,
      workspaceId,
    }),
  )
}

export const all = async (workspaceIds) => {
  const enhance = (entries) => {
    return entries.map(response).toSorted(sortByProperty('title'))
  }

  // A domain deleted while the list was read comes back as null and is left out.
  const entries = await Promise.all((await Domain.find(within(workspaceIds))).map(withIngestKey))

  return enhance(entries.filter((entry) => entry != null))
}

export const get = async (id, workspaceIds) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await withIngestKey(await Domain.findOne({ id, ...within(workspaceIds) })))
}

export const update = async (id, data, workspaceIds) => {
  const current = await Domain.findOne({ id, ...within(workspaceIds) })

  if (current != null && (await titleTaken(current.workspaceId, data.title, id)) != null)
    throw new KnownError(TITLE_TAKEN)

  const enhance = (entry) => {
    forgetCached(id)
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Domain.findOneAndUpdate(
      {
        id,
        ...within(workspaceIds),
      },
      {
        $set: {
          title: data.title,
          // Left alone when the caller does not mention it, so editing a title cannot
          // turn strict mode off by accident.
          ...(data.strictIngest == null ? {} : { strictIngest: data.strictIngest }),
          updated: Date.now(),
        },
      },
      {
        returnDocument: 'after',
        runValidators: true,
      },
    ),
  )
}

export const del = async (id, workspaceIds) => {
  const entry = await Domain.findOneAndDelete({
    id,
    ...within(workspaceIds),
  })

  forgetCached(id)
  return entry
}

// Issues a new key and invalidates the old one at once. Used when a key has been abused.
export const rotateIngestKey = async (id, workspaceIds) => {
  const entry = await Domain.findOneAndUpdate(
    { id, ...within(workspaceIds) },
    { $set: { ingestKey: newIngestKey(), updated: Date.now() } },
    { returnDocument: 'after' },
  )

  forgetCached(id)
  return entry == null ? null : response(entry)
}

/*
 * Lookups that run without a viewer.
 *
 * Two paths have no signed-in user by design: tracking, which any visitor triggers, and
 * the CORS headers, which are built before the request is authenticated. They are kept
 * apart from the scoped functions above so that skipping the workspace filter is always
 * a deliberate choice.
 */
export const getUnscoped = async (id) => {
  const entry = await withIngestKey(await Domain.findOne({ id }))

  return entry == null ? null : response(entry)
}

export const getUnscopedCached = (id) => cachedUnscoped(id)

export const allUnscoped = async () => {
  const entries = await Domain.find({})

  return entries.map(response)
}

// Which of the given domains still exist. The ingest worker drops the events of a domain
// that was deleted while they waited in the queue.
export const existingUnscoped = async (ids) => {
  const entries = await Domain.find({ id: { $in: ids } })
    .select('id')
    .lean()

  return new Set(entries.map((entry) => entry.id))
}
