import PermanentToken from '../models/PermanentToken.js'
import sortByProperty from '../utils/sortByProperty.js'

const response = (entry) => ({
  id: entry.id,
  userId: entry.userId,
  title: entry.title,
  created: entry.created,
  updated: entry.updated,
})

export const add = async (data) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await PermanentToken.create({
      title: data.title,
      userId: data.userId,
    }),
  )
}

// API tokens are personal: everything but the sign-in lookup is limited to the owner.
// Without an owner the filter would vanish and match every token of the instance, so a
// missing one is an error. The sign-in lookup has its own functions below.
const ownedBy = (userId) => {
  if (userId == null) throw new Error('A token owner is required, use the Unscoped functions to sign in')
  return { userId }
}

export const all = async (userId) => {
  const enhance = (entries) => {
    return entries.map(response).toSorted(sortByProperty('title'))
  }

  return enhance(await PermanentToken.find(ownedBy(userId)))
}

export const get = async (id, userId) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await PermanentToken.findOne({ id, ...ownedBy(userId) }))
}

export const update = async (id, data, userId) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await PermanentToken.findOneAndUpdate(
      {
        id,
        ...ownedBy(userId),
      },
      {
        $set: {
          title: data.title,
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

export const del = (id, userId) => {
  return PermanentToken.findOneAndDelete({
    id,
    ...ownedBy(userId),
  })
}

/*
 * Lookups for signing in with a token, which runs before anyone is known.
 *
 * Kept apart from the scoped functions above so that skipping the owner filter is always
 * a deliberate choice.
 */
export const getUnscoped = async (id) => {
  const entry = await PermanentToken.findOne({ id })

  return entry == null ? entry : response(entry)
}

// Records the last time the token was used.
export const touchUnscoped = (id) => {
  return PermanentToken.updateOne({ id }, { $set: { updated: Date.now() } })
}
