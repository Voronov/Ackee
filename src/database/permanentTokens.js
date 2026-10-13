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
const ownedBy = (userId) => (userId === undefined ? {} : { userId })

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
