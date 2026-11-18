import aggregateRolledViews from '../aggregations/aggregateRolledViews.js'
import aggregateViews from '../aggregations/aggregateViews.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import { VIEWS_TYPE_TOTAL, VIEWS_TYPE_UNIQUE } from '../constants/views.js'
import DimensionRollup from '../models/DimensionRollup.js'
import Record from '../models/Record.js'
import ViewRollup from '../models/ViewRollup.js'
import createArray from '../utils/createArray.js'
import matchesDate from '../utils/matchesDate.js'
import recursiveId from '../utils/recursiveId.js'
import { applyScope, filteredRollup, hasFilters, limitOf } from '../utils/scope.js'
import { coverage as rollupCoverage } from './rollups.js'

// A report without rollups reads records. With `clientId` in the match of unique views the planner
// can pick that index and read the records of every domain: 9 s instead of 0.25 s on live (BUG-72).
export const hinted = (aggregation) => Record.aggregate(aggregation).hint({ domainId: 1, created: 1 })

// A fresh database may not have the index yet, and MongoDB refuses a hint to a missing one
export const aggregateRecords = async (aggregation) => {
  try {
    return await hinted(aggregation)
  } catch (error) {
    if (/hint provided does not correspond to an existing index/.test(error.message) === false) throw error
    return Record.aggregate(aggregation)
  }
}

const get = async (ids, type, interval, askedLimit, dateDetails) => {
  const unique = type === VIEWS_TYPE_UNIQUE
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
    if (coverage != null) return aggregateRolledViews(ids, unique, interval, dateDetails, coverage, filtered)
    if (type === VIEWS_TYPE_UNIQUE)
      return applyScope(aggregateViews(ids, true, interval, limit, dateDetails), dateDetails)
    if (type === VIEWS_TYPE_TOTAL)
      return applyScope(aggregateViews(ids, false, interval, limit, dateDetails), dateDetails)
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
  return enhance(await (coverage == null ? aggregateRecords(aggregation) : rollups.aggregate(aggregation)))
}

export default get
