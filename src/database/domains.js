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
  created: entry.created,
  updated: entry.updated,
})

export const add = async (data) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Domain.create({
      title: data.title,
      ingestKey: newIngestKey(),
      // A new domain's snippet carries the key from the start, so it can be strict at once.
      strictIngest: true,
    }),
  )
}

export const all = async () => {
  const enhance = (entries) => {
    return entries.map(response).toSorted(sortByProperty('title'))
  }

  return enhance(await Promise.all((await Domain.find({})).map(withIngestKey)))
}

export const get = async (id) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await withIngestKey(await Domain.findOne({ id })))
}

export const update = async (id, data) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Domain.findOneAndUpdate(
      {
        id,
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

export const del = (id) => {
  return Domain.findOneAndDelete({
    id,
  })
}

// Issues a new key and invalidates the old one at once. Used when a key has been abused.
export const rotateIngestKey = async (id) => {
  const entry = await Domain.findOneAndUpdate(
    { id },
    { $set: { ingestKey: newIngestKey(), updated: Date.now() } },
    { returnDocument: 'after' },
  )

  return entry == null ? null : response(entry)
}
