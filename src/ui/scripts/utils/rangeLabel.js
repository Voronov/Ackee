import {
  RANGES_LAST_24_HOURS,
  RANGES_LAST_30_DAYS,
  RANGES_LAST_6_MONTHS,
  RANGES_LAST_7_DAYS,
} from '../../../constants/ranges.js'

// A period of the dashboard replaces the range (ACKEE-24)
export default (range, period) => {
  if (period != null) return `${period.from} – ${period.to}`

  return {
    [RANGES_LAST_24_HOURS]: 'Last 24 hours',
    [RANGES_LAST_7_DAYS]: 'Last 7 days',
    [RANGES_LAST_30_DAYS]: 'Last 30 days',
    [RANGES_LAST_6_MONTHS]: 'Last 6 months',
  }[range]
}
