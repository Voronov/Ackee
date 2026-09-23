import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import Record from '../models/Record.js'
import recursiveId from '../utils/recursiveId.js'
import topRecords from './topRecords.js'

const PROPERTIES = ['country']

// Country names in English, like the rest of the interface. No lookup table: Intl knows
// them all and updates with Node.
const names = new Intl.DisplayNames(['en'], { type: 'region' })

const get = async (ids, sorting, range, limit, dateDetails) => {
  const aggregation = (() => {
    if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, PROPERTIES, limit)
    if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, PROPERTIES, limit)
  })()

  const enhanceId = (id) => {
    try {
      return names.of(id.country) ?? id.country
    } catch {
      // A code Intl does not know, such as a retired one, is shown as it is.
      return id.country
    }
  }

  const enhance = (entries) => {
    return entries.map((entry) => {
      const value = enhanceId(entry._id)

      return {
        id: recursiveId([value, sorting, range, ...ids]),
        value,
        // The interface needs the code for maps and flags; a name will not do.
        code: entry._id.country,
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
