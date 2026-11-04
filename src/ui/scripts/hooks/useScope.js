import { useSyncExternalStore } from 'react'

import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../../../constants/intervals.js'
import getHistory from '../utils/history.js'

/*
 * The filters and the period of the dashboard (ACKEE-24), kept in the address so a link opens
 * the same numbers and Back undoes the last change:
 *
 *   #/insights/referrers?filter=SITE_LOCATION:https%3A%2F%2Fexample.com%2Fcart&from=2026-10-01&to=2026-10-31
 *
 * A filter without a colon has no value: the views without that field.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

const parse = (search) => {
  const parameters = new URLSearchParams(search)

  const filters = parameters.getAll('filter').map((entry) => {
    const index = entry.indexOf(':')
    return index === -1
      ? { field: entry, value: null }
      : { field: entry.slice(0, index), value: entry.slice(index + 1) }
  })

  const from = parameters.get('from')
  const to = parameters.get('to')
  const period = DAY.test(from) && DAY.test(to) && from <= to ? { from, to } : null

  return { filters, period }
}

const serialize = ({ filters, period }) => {
  const parameters = new URLSearchParams()
  for (const { field, value } of filters) parameters.append('filter', value == null ? field : `${field}:${value}`)
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

// Keeps the filters and the period on a link to another page
export const withScope = (href) => `${href}${hasDocument() === true ? getHistory().location.search : ''}`

export const isScoped = (scope) => scope.filters.length > 0 || scope.period != null

// How many days, months or years of a chart the period spans, as the server counts them
export const periodUnits = (period, interval) => {
  if (period == null) return
  const [fromYear, fromMonth] = period.from.split('-').map(Number)
  const [toYear, toMonth] = period.to.split('-').map(Number)

  if (interval === INTERVALS_DAILY) {
    return Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1
  }
  if (interval === INTERVALS_MONTHLY) return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1
  if (interval === INTERVALS_YEARLY) return toYear - fromYear + 1
}

export default () => useSyncExternalStore(subscribe, read, read)
