import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import {
  REFERRERS_TYPE_NO_SOURCE,
  REFERRERS_TYPE_ONLY_SOURCE,
  REFERRERS_TYPE_WITH_SOURCE,
} from '../constants/referrers.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import Record from '../models/Record.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

// With a source, a record counts when either field is set, hence `or`.
const dimensionFor = (type) => {
  if (type === REFERRERS_TYPE_WITH_SOURCE) return { properties: ['source', 'siteReferrer'], or: true }
  if (type === REFERRERS_TYPE_NO_SOURCE) return { properties: ['siteReferrer'], or: false }
  if (type === REFERRERS_TYPE_ONLY_SOURCE) return { properties: ['source'], or: false }
}

const get = async (ids, sorting, type, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (type === REFERRERS_TYPE_WITH_SOURCE) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['source', 'siteReferrer'], limit, true)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['source', 'siteReferrer'], limit, true)
    }
    if (type === REFERRERS_TYPE_NO_SOURCE) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['siteReferrer'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['siteReferrer'], limit)
    }
    if (type === REFERRERS_TYPE_ONLY_SOURCE) {
      if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['source'], limit)
      if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['source'], limit)
    }
  })()

  const enhanceId = (id) => {
    return id.source || id.siteReferrer
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

  const entries = await (() => {
    if (sorting !== SORTINGS_TOP) return Record.aggregate(aggregation)

    const { properties, or } = dimensionFor(type)

    return topRecords(ids, properties, range, limit, dateDetails, or)
  })()

  return enhance(entries)
}

export default get
