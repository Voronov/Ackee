import { randomBytes } from 'node:crypto'

import Domain from '../models/Domain.js'
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

export const add = async (data, workspaceId) => {
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
  const enhance = (entry) => {
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

export const del = (id, workspaceIds) => {
  return Domain.findOneAndDelete({
    id,
    ...within(workspaceIds),
  })
}

// Issues a new key and invalidates the old one at once. Used when a key has been abused.
export const rotateIngestKey = async (id, workspaceIds) => {
  const entry = await Domain.findOneAndUpdate(
    { id, ...within(workspaceIds) },
    { $set: { ingestKey: newIngestKey(), updated: Date.now() } },
    { returnDocument: 'after' },
  )

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

export const allUnscoped = async () => {
  const entries = await Domain.find({})

  return entries.map(response)
}
