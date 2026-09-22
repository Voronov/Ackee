import { randomBytes } from 'node:crypto'

import Domain from '../models/Domain.js'
import sortByProperty from '../utils/sortByProperty.js'

const response = (entry) => ({
  id: entry.id,
  workspaceId: entry.workspaceId,
  title: entry.title,
  ingestKey: entry.ingestKey,
  strictIngest: entry.strictIngest,
  created: entry.created,
  updated: entry.updated,
})

// The workspace filter belongs in the query, not in a check after reading. A forgotten
// check returns someone else's data; a forgotten filter returns nothing, which shows up
// at once.
const within = (workspaceIds) => ({ workspaceId: { $in: workspaceIds } })

export const add = async (data, workspaceId) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Domain.create({
      title: data.title,
      workspaceId,
    }),
  )
}

export const all = async (workspaceIds) => {
  const enhance = (entries) => {
    return entries.map(response).toSorted(sortByProperty('title'))
  }

  return enhance(await Domain.find(within(workspaceIds)))
}

export const get = async (id, workspaceIds) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Domain.findOne({ id, ...within(workspaceIds) }))
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

/*
 * Lookups that run without a viewer.
 *
 * Two paths have no signed-in user by design: tracking, which any visitor triggers, and
 * the CORS headers, which are built before the request is authenticated. They are kept
 * apart from the scoped functions above so that skipping the workspace filter is always
 * a deliberate choice.
 */
export const getUnscoped = async (id) => {
  const entry = await Domain.findOne({ id })

  return entry == null ? null : response(entry)
}

export const allUnscoped = async () => {
  const entries = await Domain.find({})

  return entries.map(response)
}

// Issues a new key and invalidates the old one at once. Used when a key has been abused.
export const rotateIngestKey = async (id, workspaceIds) => {
  const entry = await Domain.findOneAndUpdate(
    { id, ...within(workspaceIds) },
    { $set: { ingestKey: randomBytes(16).toString('base64url'), updated: Date.now() } },
    { returnDocument: 'after' },
  )

  return entry == null ? null : response(entry)
}
