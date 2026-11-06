import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarYears,
  format,
} from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'

import { FILTER_FIELDS, FILTER_VALUE_MAX_LENGTH, FILTERS_MAX, PERIOD_MAX_DAYS } from '../constants/filters.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import createDate from './createDate.js'
import KnownError from './KnownError.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/

// A day as the viewer names it, YYYY-MM-DD. The date of the server's zone only does the arithmetic.
const parseDay = (value) => {
  const date = new Date(`${value}T00:00:00`)
  if (DAY.test(value) === false || Number.isNaN(date.getTime()) || format(date, 'yyyy-MM-dd') !== value) {
    throw new KnownError(`Invalid day '${value}', expected YYYY-MM-DD`)
  }

  return date
}

const startOfDayIn = (date, timeZone) => fromZonedTime(`${format(date, 'yyyy-MM-dd')}T00:00:00`, timeZone)

const parseFilters = (filters = []) => {
  if (filters.length > FILTERS_MAX) throw new KnownError(`At most ${FILTERS_MAX} filters`)

  return filters.map(({ field, value }) => {
    if (value != null && value.length > FILTER_VALUE_MAX_LENGTH) throw new KnownError('Filter value too long')
    // Null is a record without the field, as in the groups of a list
    return { field: FILTER_FIELDS[field], value: value ?? null }
  })
}

const parsePeriod = (period, timeZone) => {
  const from = parseDay(period.from)
  const to = parseDay(period.to)

  const days = differenceInCalendarDays(to, from) + 1
  if (days < 1) throw new KnownError('The period ends before it starts')
  if (days > PERIOD_MAX_DAYS) throw new KnownError(`A period has at most ${PERIOD_MAX_DAYS} days`)

  const units = {
    [INTERVALS_DAILY]: days,
    [INTERVALS_MONTHLY]: differenceInCalendarMonths(to, from) + 1,
    [INTERVALS_YEARLY]: differenceInCalendarYears(to, from) + 1,
  }

  // [start, end): from the first moment of `from` to the first moment after `to`, in the viewer's zone
  return {
    start: startOfDayIn(from, timeZone),
    end: startOfDayIn(addDays(to, 1), timeZone),
    limitFor: (interval) => units[interval],
  }
}

/*
 * The date details of a request, narrowed by the filters and the period of the dashboard (ACKEE-24).
 * With a period the reports count back from its end, as they do from now without one: a chart
 * of DAILY views shows the days of the period, a list counts the records of [start, end).
 * Without either, the details are returned as they are.
 */
export const createScope = (dateDetails, { filters, period } = {}) => {
  const conditions = parseFilters(filters ?? [])
  if (conditions.length === 0 && period == null) return dateDetails

  const range = period == null ? undefined : parsePeriod(period, dateDetails.userTimeZone)
  const base = range == null ? dateDetails : createDate(dateDetails.userTimeZone, new Date(range.end.getTime() - 1))

  return {
    ...base,
    filters: conditions,
    start: range?.start,
    end: range?.end,
    limitFor: range?.limitFor,
    // Results of another scope must not share the ids of the interface's cache
    key: JSON.stringify([conditions, period?.from, period?.to]),
  }
}

export const hasFilters = (dateDetails) => (dateDetails.filters?.length ?? 0) > 0

// How many days, months or years a chart shows: the units of the period, or what was asked for
export const limitOf = (dateDetails, interval, limit) => dateDetails.limitFor?.(interval) ?? limit

// Adds the filters and the period to the first stage of an aggregation of records, which
// matches the domains. $and keeps a filter apart from the conditions the report already has on
// the same field, like `siteReferrer: { $ne: null }` of the referrers.
export const applyScope = (aggregation, dateDetails) => {
  const match = aggregation[0].$match

  for (const { field, value } of dateDetails.filters ?? []) {
    match.$and = [...(match.$and ?? []), { [field]: value }]
  }

  // First seen comes from all records of an entry, so NEW counts the period but matches every record
  const group = aggregation[1]?.$group
  if (dateDetails.start != null && group?.created?.$min != null) {
    const inPeriod = { $and: [{ $gte: ['$created', dateDetails.start] }, { $lt: ['$created', dateDetails.end] }] }
    group.count = { $sum: { $cond: [inPeriod, 1, 0] } }
    aggregation.splice(2, 0, { $match: { count: { $gt: 0 } } })
    return aggregation
  }

  if (dateDetails.start != null) match.created = { ...match.created, $gte: dateDetails.start }
  if (dateDetails.end != null) match.created = { ...match.created, $lt: dateDetails.end }

  return aggregation
}
