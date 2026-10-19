import {
  RANGES_LAST_24_HOURS,
  RANGES_LAST_30_DAYS,
  RANGES_LAST_6_MONTHS,
  RANGES_LAST_7_DAYS,
} from '../constants/ranges.js'

// The first moment of a range, as aggregateTopRecords filters it. Undefined means all time.
export default (range, dateDetails) => {
  if (range === RANGES_LAST_24_HOURS) return dateDetails.lastHours(24)
  if (range === RANGES_LAST_7_DAYS) return dateDetails.lastDays(7)
  if (range === RANGES_LAST_30_DAYS) return dateDetails.lastDays(30)
  if (range === RANGES_LAST_6_MONTHS) return dateDetails.lastMonths(6)
}
