import Event from '../models/Event.js'
import sortByProperty from '../utils/sortByProperty.js'

const response = (entry) => ({
  id: entry.id,
  workspaceId: entry.workspaceId,
  title: entry.title,
  type: entry.type,
  created: entry.created,
  updated: entry.updated,
})

// Same rule as for domains: the workspace filter lives in the query, not in a check after
// reading. A forgotten check returns someone else's data; a forgotten filter returns none.
const within = (workspaceIds) => ({ workspaceId: { $in: workspaceIds } })

export const add = async (data, workspaceId) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Event.create({ ...data, workspaceId }))
}

export const all = async (workspaceIds) => {
  const enhance = (entries) => {
    return entries.map(response).toSorted(sortByProperty('title'))
  }

  return enhance(await Event.find(within(workspaceIds)))
}

export const get = async (id, workspaceIds) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Event.findOne({ id, ...within(workspaceIds) }))
}

// Recording an action is unauthenticated, exactly like tracking a page view, so the event
// behind it is looked up without a workspace filter.
export const getUnscoped = async (id) => {
  const entry = await Event.findOne({ id })

  return entry == null ? null : response(entry)
}

export const update = async (id, data, workspaceIds) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Event.findOneAndUpdate(
      {
        id,
        ...within(workspaceIds),
      },
      {
        $set: {
          title: data.title,
          type: data.type,
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
  return Event.findOneAndDelete({
    id,
    ...within(workspaceIds),
  })
}
