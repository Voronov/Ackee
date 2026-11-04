import { toZonedTime } from 'date-fns-tz'

import aggregateRolledViews from '../aggregations/aggregateRolledViews.js'
import aggregateViews from '../aggregations/aggregateViews.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import { VIEWS_TYPE_TOTAL, VIEWS_TYPE_UNIQUE } from '../constants/views.js'
import Record from '../models/Record.js'
import ViewRollup from '../models/ViewRollup.js'
import createArray from '../utils/createArray.js'
import matchesDate from '../utils/matchesDate.js'
import recursiveId from '../utils/recursiveId.js'
import { applyScope, hasFilters, limitOf } from '../utils/scope.js'
import { coverage as rollupCoverage } from './rollups.js'

const get = async (ids, type, interval, askedLimit, dateDetails) => {
  const unique = type === VIEWS_TYPE_UNIQUE
  const limit = limitOf(dateDetails, interval, askedLimit)
  // Rollups count whole domains, a filtered report reads records (ACKEE-24)
  const coverage =
    hasFilters(dateDetails) === true
      ? undefined
      : await rollupCoverage(
          dateDetails.includeFnByInterval(interval)(limit),
          dateDetails.userTimeZone,
          dateDetails.end,
        )

  const aggregation = (() => {
    if (coverage != null) return aggregateRolledViews(ids, unique, interval, dateDetails, coverage)
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
      const date = dateDetails.lastFnByInterval(interval)(index)

      // Database entries include the day, month and year in the
      // timezone of the user. We therefore need to match it against a
      // date in the timezone of the user.
      const userZonedDate = toZonedTime(date, dateDetails.userTimeZone)

      // Find a entry that matches the date
      const entry = entries.find((entry) => {
        return matchesDate(
          matchDay === true ? entry._id.day : undefined,
          matchMonth === true ? entry._id.month : undefined,
          matchYear === true ? entry._id.year : undefined,
          userZonedDate,
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

  const model = coverage == null ? Record : ViewRollup

  return enhance(await model.aggregate(aggregation))
}

export default get
