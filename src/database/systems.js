import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import { SYSTEMS_TYPE_NO_VERSION, SYSTEMS_TYPE_WITH_VERSION } from '../constants/systems.js'
import Record from '../models/Record.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

const propertiesFor = (type) => {
  if (type === SYSTEMS_TYPE_NO_VERSION) return ['osName']
  if (type === SYSTEMS_TYPE_WITH_VERSION) return ['osName', 'osVersion']
}

const get = async (ids, sorting, type, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (type === SYSTEMS_TYPE_NO_VERSION) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['osName'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['osName'], limit)
    }
    if (type === SYSTEMS_TYPE_WITH_VERSION) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['osName', 'osVersion'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['osName', 'osVersion'], limit)
    }
  })()

  const enhanceId = (id) => {
    if (type === SYSTEMS_TYPE_NO_VERSION) return `${id.osName}`
    if (type === SYSTEMS_TYPE_WITH_VERSION) return `${id.osName} ${id.osVersion}`
  }

  const enhance = (entries) => {
    return entries.map((entry) => {
      const value = enhanceId(entry._id)

      return {
        id: recursiveId([value, sorting, type, range, ...ids]),
        value,
        count: entry.count,
        created: entry.created,
      }
    })
  }

  const entries =
    sorting === SORTINGS_TOP
      ? await topRecords(ids, propertiesFor(type), range, limit, dateDetails)
      : await Record.aggregate(aggregation)

  return enhance(entries)
}

export default get
