import { createContext, useContext, useSyncExternalStore } from 'react'

import { FILTER_FIELDS, FILTER_VALUE_MAX_LENGTH, FILTERS_MAX, PERIOD_MAX_DAYS } from '../../../constants/filters.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../../../constants/intervals.js'
import isDay from '../../../utils/isDay.js'
import getHistory from '../utils/history.js'

/*
 * The filters and the period of the dashboard (ACKEE-24), kept in the address so a link opens
 * the same numbers and Back undoes the last change:
 *
 *   #/insights/referrers?filter=SITE_LOCATION:https%3A%2F%2Fexample.com%2Fcart&from=2026-10-01&to=2026-10-31
 *
 * A filter without a colon has no value: the views without that field.
 */

const daysOf = ({ from, to }) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

// The rule of the server. A chart has one bar per day, so a longer period would crash the page.
export const isPeriod = ({ from, to }) =>
  isDay(from) && isDay(to) && from <= to && daysOf({ from, to }) <= PERIOD_MAX_DAYS

// The rule of the server too. A value it refuses would end on the failure page.
export const isFilter = ({ field, value }) =>
  Object.hasOwn(FILTER_FIELDS, field) && (value == null || value.length <= FILTER_VALUE_MAX_LENGTH)

export const parse = (search) => {
  const parameters = new URLSearchParams(search)

  const filters = parameters.getAll('filter').map((entry) => {
    const index = entry.indexOf(':')
    return index === -1
      ? { field: entry, value: null }
      : { field: entry.slice(0, index), value: entry.slice(index + 1) }
  })

  const from = parameters.get('from')
  const to = parameters.get('to')
  const period = isPeriod({ from, to }) ? { from, to } : null

  return { filters: filters.filter(isFilter).slice(0, FILTERS_MAX), period }
}

const filterText = ({ field, value }) => (value == null ? field : `${field}:${value}`)

const serialize = ({ filters, period }) => {
  const parameters = new URLSearchParams()
  for (const filter of filters) parameters.append('filter', filterText(filter))
  if (period != null) {
    parameters.set('from', period.from)
    parameters.set('to', period.to)
  }

  const search = parameters.toString()
  return search === '' ? '' : `?${search}`
}

// The same search gives the same object, so React sees no change between renders
let cached = { search: undefined, scope: undefined }
const EMPTY = { filters: [], period: null }
const hasDocument = () => typeof document !== 'undefined'

const read = () => {
  if (hasDocument() === false) return EMPTY
  const { search } = getHistory().location
  if (cached.search !== search) cached = { search, scope: parse(search) }
  return cached.scope
}

const subscribe = (listener) => (hasDocument() === true ? getHistory().listen(listener) : () => {})

const update = (change) => {
  const history = getHistory()
  history.push({ pathname: history.location.pathname, search: serialize(change(read())) })
}

// A field takes one value: a new one for the same field replaces the old
export const addFilters = (conditions) =>
  update((scope) => ({
    ...scope,
    filters: [
      ...scope.filters.filter((filter) => conditions.some((condition) => condition.field === filter.field) === false),
      ...conditions.map(({ field, value }) => ({ field, value: value ?? null })),
    ],
  }))

export const removeFilter = (field) =>
  update((scope) => ({ ...scope, filters: scope.filters.filter((filter) => filter.field !== field) }))

export const setPeriod = (period) => update((scope) => ({ ...scope, period }))

export const clearScope = () => update(() => ({ filters: [], period: null }))

// Takes what parse dropped out of the address. Replaces the entry, so Back does not return to it.
export const cleanAddress = () => {
  const history = getHistory()
  const { pathname, search } = history.location
  const parameters = new URLSearchParams(search)
  const { filters, period } = parse(search)

  const droppedPeriod = period == null && (parameters.has('from') || parameters.has('to'))
  if (droppedPeriod || filters.length < parameters.getAll('filter').length) {
    history.replace({ pathname, search: serialize({ filters, period }) })
  }
}

// Keeps the filters and the period on a link to another page
export const withScope = (href) => `${href}${hasDocument() === true ? getHistory().location.search : ''}`

export const isScoped = (scope) => scope.filters.length > 0 || scope.period != null

// The scope as the parameters of /export
export const exportParameters = ({ filters, period }) => ({
  filter: filters.map(filterText),
  from: period?.from,
  to: period?.to,
})

// How many days, months or years of a chart the period spans, as the server counts them
export const periodUnits = (period, interval) => {
  if (period == null || isPeriod(period) === false) return
  const [fromYear, fromMonth] = period.from.split('-').map(Number)
  const [toYear, toMonth] = period.to.split('-').map(Number)

  if (interval === INTERVALS_DAILY) return daysOf(period)
  if (interval === INTERVALS_MONTHLY) return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1
  if (interval === INTERVALS_YEARLY) return toYear - fromYear + 1
}

// The name of a bar of a chart: bars count back from the end of the period
export const periodLabel = (period, interval, offset) => {
  const date = new Date(`${period.to}T00:00:00Z`)

  if (interval === INTERVALS_DAILY) {
    date.setUTCDate(date.getUTCDate() - offset)
    return date.toISOString().slice(0, 10)
  }
  if (interval === INTERVALS_MONTHLY) {
    date.setUTCMonth(date.getUTCMonth() - offset, 1)
    return date.toISOString().slice(0, 7)
  }
  if (interval === INTERVALS_YEARLY) return String(date.getUTCFullYear() - offset)
}

// The scope below instead of the address: a dialog keeps the one of the bar it was opened from
export const ScopeContext = createContext(null)

export default () => {
  const pinned = useContext(ScopeContext)
  const current = useSyncExternalStore(subscribe, read, read)

  return pinned ?? current
}
