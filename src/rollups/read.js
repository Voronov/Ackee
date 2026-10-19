import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import {
  RANGES_LAST_24_HOURS,
  RANGES_LAST_30_DAYS,
  RANGES_LAST_6_MONTHS,
  RANGES_LAST_7_DAYS,
} from '../constants/ranges.js'
import Record from '../models/Record.js'
import Rollup from '../models/Rollup.js'
import RollupState from '../models/RollupState.js'
import matchLimit from '../stages/matchLimit.js'
import projectDuration from '../stages/projectDuration.js'
import projectMinInterval from '../stages/projectMinInterval.js'
import config from '../utils/config.js'
import { ceilHour, compareEntries, dimensionName, floorHour, hashKey, keyOf } from './dimension.js'
import { DURATIONS, UNIQUE_VIEWS, VIEWS } from './registry.js'

const rangeStart = (range, dateDetails) => {
  if (range === RANGES_LAST_24_HOURS) return dateDetails.lastHours(24)
  if (range === RANGES_LAST_7_DAYS) return dateDetails.lastDays(7)
  if (range === RANGES_LAST_30_DAYS) return dateDetails.lastDays(30)
  if (range === RANGES_LAST_6_MONTHS) return dateDetails.lastMonths(6)
  return null
}

const presence = (properties, or) =>
  or === true
    ? { $or: properties.map((property) => ({ [property]: { $ne: null } })) }
    : Object.fromEntries(properties.map((property) => [property, { $ne: null }]))

// The same `$group` as the original aggregation but over a short range. It covers the
// edges of a window that do not fall on whole hours.
const rawSlice = (ids, properties, or, from, to) => {
  if (from >= to) return []

  return Record.aggregate([
    {
      $match: {
        ...(ids == null ? {} : { domainId: { $in: ids } }),
        ...presence(properties, or),
        created: { $gte: from, $lt: to },
      },
    },
    {
      $group: {
        _id: Object.fromEntries(properties.map((property) => [property, `$${property}`])),
        count: { $sum: 1 },
      },
    },
  ])
}

// Whether rollups cover every requested domain over the whole range.
const isCovered = async (ids, from, to) => {
  if (ids == null || ids.length === 0) return false

  const states = await RollupState.find({ domainId: { $in: ids } }).lean()
  if (states.length !== ids.length) return false

  return states.every((state) => state.from <= from && state.to >= to)
}

// Top records for a dimension, read from hourly rollups. `null` means this path cannot
// answer, and the caller should fall back to raw records.
export const topRecords = async (ids, properties, range, limit, dateDetails, or = false) => {
  if (config.rollups !== true) return null

  // A dimension with no fields is views, which has its own read path. Without this check
  // the query would look up an empty dimension name and quietly return nothing.
  if (properties.length === 0) return null

  const from = rangeStart(range, dateDetails)
  if (from == null) return null

  const now = new Date()
  const hotFrom = ceilHour(from)
  const hotTo = floorHour(now)

  // A window shorter than an hour holds no whole buckets, so rollups cannot help.
  if (hotFrom >= hotTo) return null
  if ((await isCovered(ids, from, hotTo)) === false) return null

  const name = dimensionName(properties, or)

  // Whole hours come from the rollups.
  const buckets = await Rollup.aggregate([
    { $match: { domainId: { $in: ids }, dimension: name, bucket: { $gte: hotFrom, $lt: hotTo } } },
    { $group: { _id: '$keyHash', key: { $first: '$key' }, count: { $sum: '$count' } } },
  ])

  // The edges are the partial hour at the start of the window and the current, unfinished
  // one. Together that is at most two hours, read through the compound index.
  const [head, tail] = await Promise.all([
    rawSlice(ids, properties, or, from, hotFrom),
    rawSlice(ids, properties, or, hotTo, now),
  ])

  const totals = new Map()

  for (const entry of buckets) {
    totals.set(entry._id, { key: entry.key, count: entry.count })
  }

  for (const entry of [...head, ...tail]) {
    const key = keyOf(properties, entry._id)
    const hash = hashKey(key)
    const current = totals.get(hash)

    totals.set(hash, { key, count: (current?.count ?? 0) + entry.count })
  }

  // The order matches aggregateTopRecords, secondary key included. Otherwise the two read
  // paths would return different rows at the cut-off.
  return [...totals.values()]
    .toSorted(compareEntries(properties))
    .slice(0, limit)
    .map((entry) => ({ _id: entry.key, count: entry.count }))
}

// Groups views by day, month or year in the visitor's time zone. For rollups it applies
// to the bucket start, for raw records to `created`. Since every event in a bucket falls
// inside one hour, both give the same group for whole-hour offsets.
const viewsGroupId = (field, interval, timeZone) => {
  const date = { date: field, timezone: timeZone }
  const id = {}

  if (interval === INTERVALS_DAILY) id.day = { $dayOfMonth: date }
  if ([INTERVALS_DAILY, INTERVALS_MONTHLY].includes(interval)) id.month = { $month: date }
  if ([INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY].includes(interval)) id.year = { $year: date }

  return id
}

// Raw records of an edge around the whole hours, grouped as the original aggregation
// groups them. `to` is open for the tail: the original aggregation has no upper bound.
const rawIntervals = (ids, interval, timeZone, from, to, { match = {}, durations = false }) => {
  if (to != null && from >= to) return []

  return Record.aggregate([
    { $match: { domainId: { $in: ids }, ...match, created: to == null ? { $gte: from } : { $gte: from, $lt: to } } },
    ...(durations === true ? [projectDuration(), projectMinInterval(), matchLimit()] : []),
    {
      $group: {
        _id: viewsGroupId('$created', interval, timeZone),
        count: { $sum: 1 },
        ...(durations === true ? { sum: { $sum: '$duration' } } : {}),
      },
    },
  ])
}

const bucketIntervals = (ids, name, interval, timeZone, from, to, durations) =>
  Rollup.aggregate([
    { $match: { domainId: { $in: ids }, dimension: name, bucket: { $gte: from, $lt: to } } },
    {
      $group: {
        _id: viewsGroupId('$bucket', interval, timeZone),
        count: { $sum: '$count' },
        ...(durations === true ? { sum: { $sum: '$sum' } } : {}),
      },
    },
  ])

// Whole hours up to `hotTo` from the rollups, the edges from raw records. `null` means
// the caller should read raw records.
const readIntervals = async ({ ids, name, interval, limit, dateDetails, hotTo, match, durations = false }) => {
  const from = dateDetails.includeFnByInterval(interval)(limit)
  const hotFrom = ceilHour(from)

  if (hotFrom >= hotTo) return null
  if ((await isCovered(ids, from, hotTo)) === false) return null

  const timeZone = dateDetails.userTimeZone
  const options = { match, durations }

  const parts = await Promise.all([
    bucketIntervals(ids, name, interval, timeZone, hotFrom, hotTo, durations),
    rawIntervals(ids, interval, timeZone, from, hotFrom, options),
    rawIntervals(ids, interval, timeZone, hotTo, undefined, options),
  ])

  const totals = new Map()

  for (const entry of parts.flat()) {
    const key = JSON.stringify(entry._id)
    const current = totals.get(key)

    totals.set(key, {
      _id: entry._id,
      count: (current?.count ?? 0) + entry.count,
      sum: (current?.sum ?? 0) + (entry.sum ?? 0),
    })
  }

  return [...totals.values()]
}

// Total views from rollups. `null` means the caller should read raw records.
export const views = async (ids, interval, limit, dateDetails) => {
  if (config.rollups !== true) return null

  const entries = await readIntervals({ ids, name: VIEWS, interval, limit, dateDetails, hotTo: floorHour(new Date()) })

  return entries?.map(({ _id, count }) => ({ _id, count })) ?? null
}

// The earliest `sealed` over the requested domains, or `null` when one of them has none.
const sealedUntil = async (ids) => {
  if (ids == null || ids.length === 0) return null

  const states = await RollupState.find({ domainId: { $in: ids } }).lean()
  if (states.length !== ids.length || states.some((state) => state.sealed == null)) return null

  return new Date(Math.min(...states.map((state) => state.sealed.getTime())))
}

/*
 * Spike ACKEE-15. Unique views from rollups for days that are over, raw records for the
 * rest. `null` means the caller should read raw records.
 *
 * A unique view is a record that still carries a clientId. The count sums across buckets,
 * but it shrinks after the fact: the next visit of the same visitor on the same day
 * anonymizes their earlier records. Only once the salt has changed is a day final.
 */
export const uniqueViews = async (ids, interval, limit, dateDetails) => {
  if (config.rollups !== true || config.rollupsUnique !== true) return null

  const sealed = await sealedUntil(ids)
  if (sealed == null) return null

  const hotTo = new Date(Math.min(floorHour(new Date()).getTime(), sealed.getTime()))

  const entries = await readIntervals({
    ids,
    name: UNIQUE_VIEWS,
    interval,
    limit,
    dateDetails,
    hotTo,
    match: { clientId: { $exists: true, $ne: null } },
  })

  return entries?.map(({ _id, count }) => ({ _id, count })) ?? null
}

/*
 * Spike ACKEE-15. Average durations from rollups. `null` means the caller should read raw
 * records.
 *
 * A duration grows while the visitor stays, and a record past DURATIONS_LIMIT drops out
 * of the average. Both happen within half an hour of `created`, inside the two hours the
 * worker rebuilds on every pass, so the closed buckets do not change any more.
 */
export const durations = async (ids, interval, limit, dateDetails) => {
  if (config.rollups !== true || config.rollupsDurations !== true) return null

  const entries = await readIntervals({
    ids,
    name: DURATIONS,
    interval,
    limit,
    dateDetails,
    hotTo: floorHour(new Date()),
    durations: true,
  })

  return entries?.map(({ _id, count, sum }) => ({ _id, count: sum / count })) ?? null
}
