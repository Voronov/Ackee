import Workspace from '../models/Workspace.js'
import sortByProperty from '../utils/sortByProperty.js'

const response = (entry) => ({
  id: entry.id,
  title: entry.title,
  created: entry.created,
})

export const all = async (ids) => {
  const entries = await Workspace.find({ id: { $in: ids } }).lean()

  return entries.map(response).toSorted(sortByProperty('title'))
}
