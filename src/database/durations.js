import aggregateDurations from '../aggregations/aggregateDurations.js'
import aggregateRolledDurations from '../aggregations/aggregateRolledDurations.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import DimensionRollup from '../models/DimensionRollup.js'
import Record from '../models/Record.js'
import ViewRollup from '../models/ViewRollup.js'
import createArray from '../utils/createArray.js'
import matchesDate from '../utils/matchesDate.js'
import recursiveId from '../utils/recursiveId.js'
import { applyScope, filteredRollup, hasFilters, limitOf } from '../utils/scope.js'
import { coverage as rollupCoverage } from './rollups.js'

const get = async (ids, interval, askedLimit, dateDetails) => {
  const limit = limitOf(dateDetails, interval, askedLimit)
  // A filter by the fields of one dimension reads its rollups, other filters read records (BUG-72)
  const filtered = filteredRollup(dateDetails)
  const coverage =
    hasFilters(dateDetails) === true && filtered == null
      ? undefined
      : await rollupCoverage(
          dateDetails.start ?? dateDetails.includeFnByInterval(interval)(limit),
          dateDetails.userTimeZone,
          dateDetails.end,
        )

  const aggregation = (() => {
    if (coverage != null) return aggregateRolledDurations(ids, interval, dateDetails, coverage, filtered)
    return applyScope(aggregateDurations(ids, interval, limit, dateDetails), dateDetails)
  })()

  const enhance = (entries) => {
    const matchDay = [INTERVALS_DAILY].includes(interval)
    const matchMonth = [INTERVALS_DAILY, INTERVALS_MONTHLY].includes(interval)
    const matchYear = [INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY].includes(interval)

    return createArray(limit).map((_, index) => {
      // Database entries include the day, month and year in the timezone of the user, as this date does
      const date = dateDetails.lastFnByInterval(interval)(index)

      // Find a entry that matches the date
      const entry = entries.find((entry) => {
        return matchesDate(
          matchDay === true ? entry._id.day : undefined,
          matchMonth === true ? entry._id.month : undefined,
          matchYear === true ? entry._id.year : undefined,
          date,
        )
      })

      const value = (() => {
        if (matchDay === true) return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
        if (matchMonth === true) return `${date.getFullYear()}-${date.getMonth() + 1}`
        if (matchYear === true) return `${date.getFullYear()}`
      })()

      return {
        id: recursiveId([value, ...ids]),
        value,
        count: entry == null ? 0 : entry.count,
      }
    })
  }

  const rollups = filtered == null ? ViewRollup : DimensionRollup
  const model = coverage == null ? Record : rollups

  return enhance(await model.aggregate(aggregation))
}

export default get
