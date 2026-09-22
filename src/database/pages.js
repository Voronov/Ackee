import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import Record from '../models/Record.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

const PROPERTIES = ['siteLocation']

const get = async (ids, sorting, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, PROPERTIES, limit)
    if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, PROPERTIES, limit)
  })()

  const enhanceId = (id) => {
    return id.siteLocation
  }

  const enhance = (entries) => {
    return entries.map((entry) => {
      const value = enhanceId(entry._id)

      return {
        id: recursiveId([value, sorting, range, ...ids]),
        value,
        count: entry.count,
        created: entry.created,
      }
    })
  }

  const entries =
    sorting === SORTINGS_TOP
      ? await topRecords(ids, PROPERTIES, range, limit, dateDetails)
      : await Record.aggregate(aggregation)

  return enhance(entries)
}

export default get
