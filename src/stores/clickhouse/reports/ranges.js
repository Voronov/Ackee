import {
  RANGES_LAST_24_HOURS,
  RANGES_LAST_30_DAYS,
  RANGES_LAST_6_MONTHS,
  RANGES_LAST_7_DAYS,
} from '../../../constants/ranges.js'

// Same bounds as src/aggregations/aggregateTopRecords.js; an unknown range means no bound
const rangeStart = (range, dateDetails) => {
  if (range === RANGES_LAST_24_HOURS) return dateDetails.lastHours(24)
  if (range === RANGES_LAST_7_DAYS) return dateDetails.lastDays(7)
  if (range === RANGES_LAST_30_DAYS) return dateDetails.lastDays(30)
  if (range === RANGES_LAST_6_MONTHS) return dateDetails.lastMonths(6)
}

export const rangeFilter = (range, dateDetails) => {
  const from = rangeStart(range, dateDetails)

  if (from == null) return { clause: '', parameters: {} }

  return { clause: 'AND created >= {from:DateTime64(3)}', parameters: { from } }
}
