import { toZonedTime } from 'date-fns-tz'

import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../../../constants/intervals.js'
import createArray from '../../../utils/createArray.js'
import matchesDate from '../../../utils/matchesDate.js'
import recursiveId from '../../../utils/recursiveId.js'

const matchDay = (interval) => interval === INTERVALS_DAILY
const matchMonth = (interval) => [INTERVALS_DAILY, INTERVALS_MONTHLY].includes(interval)
const matchYear = (interval) => [INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY].includes(interval)

const parts = (interval) =>
  [
    matchYear(interval) === true && 'year',
    matchMonth(interval) === true && 'month',
    matchDay(interval) === true && 'day',
  ].filter(Boolean)

// MongoDB's `timezone` takes UTC offsets (`+02:00`, `+0530`, `+05`) next to IANA names,
// ClickHouse's time zone argument does not, so an offset is shifted by hand instead
const offsetPattern = /^([+-])(\d\d):?(\d\d)?$/

const offsetMinutes = (timeZone) => {
  const [, sign, hours, minutes = '00'] = timeZone.match(offsetPattern)
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes))
}

const local = (timeZone) =>
  offsetPattern.test(timeZone) ? "addMinutes(created, {offset:Int32}), 'UTC'" : 'created, {timeZone:String}'

const functions = { year: 'toYear', month: 'toMonth', day: 'toDayOfMonth' }

// Grouping happens in the user's time zone, as $dayOfMonth/$month/$year with `timezone` do
export const intervalColumns = (interval, timeZone) =>
  parts(interval)
    .map((part) => `${functions[part]}(${local(timeZone)}) AS ${part}`)
    .join(',\n      ')

export const intervalParameters = (timeZone) =>
  offsetPattern.test(timeZone) ? { offset: offsetMinutes(timeZone) } : { timeZone }

export const intervalGroupBy = (interval) => parts(interval).join(', ')

// Same filling as the enhance step of src/database/views.js, durations.js and
// actions.js, over rows with flat `day`, `month`, `year` and `count` columns
export const fillIntervals = (rows, ids, interval, limit, dateDetails) => {
  return createArray(limit).map((_, index) => {
    const date = dateDetails.lastFnByInterval(interval)(index)
    const userZonedDate = toZonedTime(date, dateDetails.userTimeZone)

    const row = rows.find((row) => {
      return matchesDate(
        matchDay(interval) === true ? row.day : undefined,
        matchMonth(interval) === true ? row.month : undefined,
        matchYear(interval) === true ? row.year : undefined,
        userZonedDate,
      )
    })

    const value = (() => {
      if (matchDay(interval) === true) return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      if (matchMonth(interval) === true) return `${date.getFullYear()}-${date.getMonth() + 1}`
      if (matchYear(interval) === true) return `${date.getFullYear()}`
    })()

    return {
      id: recursiveId([value, ...ids]),
      value,
      count: row == null ? 0 : row.count,
    }
  })
}
