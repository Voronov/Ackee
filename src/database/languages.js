import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import Record from '../models/Record.js'
import languageCodes from '../utils/languageCodes.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

const PROPERTIES = ['siteLanguage']

const get = async (ids, sorting, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, ['siteLanguage'], limit)
    if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, ['siteLanguage'], limit)
  })()

  const enhanceId = (id) => {
    return languageCodes[id.siteLanguage] || id.siteLanguage
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
