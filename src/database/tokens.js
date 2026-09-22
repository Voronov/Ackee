import Token from '../models/Token.js'

const response = (entry) => ({
  id: entry.id,
  userId: entry.userId,
  created: entry.created,
  updated: entry.updated,
})

export const add = async (userId) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Token.create({ userId }))
}

export const get = async (id) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Token.findOne({ id }))
}

export const update = async (id) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Token.findOneAndUpdate(
      {
        id,
      },
      {
        $set: {
          updated: Date.now(),
        },
      },
      {
        returnDocument: 'after',
      },
    ),
  )
}

export const del = (id) => {
  return Token.findOneAndDelete({
    id,
  })
}
