import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import { DEVICES_TYPE_NO_MODEL, DEVICES_TYPE_WITH_MODEL } from '../constants/devices.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import Record from '../models/Record.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

const propertiesFor = (type) => {
  if (type === DEVICES_TYPE_NO_MODEL) return ['deviceManufacturer']
  if (type === DEVICES_TYPE_WITH_MODEL) return ['deviceManufacturer', 'deviceName']
}

const get = async (ids, sorting, type, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (type === DEVICES_TYPE_NO_MODEL) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['deviceManufacturer'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['deviceManufacturer'], limit)
    }
    if (type === DEVICES_TYPE_WITH_MODEL) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['deviceManufacturer', 'deviceName'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['deviceManufacturer', 'deviceName'], limit)
    }
  })()

  const enhanceId = (id) => {
    if (type === DEVICES_TYPE_NO_MODEL) return `${id.deviceManufacturer}`
    if (type === DEVICES_TYPE_WITH_MODEL) return `${id.deviceManufacturer} ${id.deviceName}`
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
