import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import { BROWSERS_TYPE_NO_VERSION, BROWSERS_TYPE_WITH_VERSION } from '../constants/browsers.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import Record from '../models/Record.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

const propertiesFor = (type) => {
  if (type === BROWSERS_TYPE_NO_VERSION) return ['browserName']
  if (type === BROWSERS_TYPE_WITH_VERSION) return ['browserName', 'browserVersion']
}

const get = async (ids, sorting, type, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (type === BROWSERS_TYPE_NO_VERSION) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['browserName'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['browserName'], limit)
    }
    if (type === BROWSERS_TYPE_WITH_VERSION) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['browserName', 'browserVersion'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['browserName', 'browserVersion'], limit)
    }
  })()

  const enhanceId = (id) => {
    if (type === BROWSERS_TYPE_NO_VERSION) return `${id.browserName}`
    if (type === BROWSERS_TYPE_WITH_VERSION) return `${id.browserName} ${id.browserVersion}`
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
