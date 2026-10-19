import { toZonedTime } from 'date-fns-tz'

import aggregateDurations from '../aggregations/aggregateDurations.js'
import aggregateRolledDurations from '../aggregations/aggregateRolledDurations.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import Record from '../models/Record.js'
import ViewRollup from '../models/ViewRollup.js'
import createArray from '../utils/createArray.js'
import matchesDate from '../utils/matchesDate.js'
import recursiveId from '../utils/recursiveId.js'
import { coverage as rollupCoverage } from './rollups.js'

const get = async (ids, interval, limit, dateDetails) => {
  const coverage = await rollupCoverage(dateDetails.includeFnByInterval(interval)(limit), dateDetails.userTimeZone)

  const aggregation = (() => {
    if (coverage != null) return aggregateRolledDurations(ids, interval, dateDetails, coverage)
    return aggregateDurations(ids, interval, limit, dateDetails)
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
