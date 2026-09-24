import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../../../constants/sortings.js'
import recursiveId from '../../../utils/recursiveId.js'
import { fillIntervals, intervalColumns, intervalGroupBy, intervalParameters } from './intervals.js'
import { rangeFilter } from './ranges.js'
import select from './select.js'

// $sum of no values is 0 in MongoDB while sum() of only NULLs is NULL; $avg and avg()
// both give null then
const aggregate = (type) => {
  if (type === 'TOTAL') return 'coalesce(sum(value), 0)'
  if (type === 'AVERAGE') return 'avg(value)'
}

export const chart = async (ids, type, interval, limit, dateDetails) => {
  const rows = await select(
    `
      SELECT
        ${intervalColumns(interval, dateDetails.userTimeZone)},
        ${aggregate(type)} AS count
      FROM {database:Identifier}.actions FINAL
      WHERE eventId IN {ids:Array(String)}
        AND created >= {from:DateTime64(3)}
      GROUP BY ${intervalGroupBy(interval)}
    `,
    { ids, from: dateDetails.includeFnByInterval(interval)(limit), ...intervalParameters(dateDetails.userTimeZone) },
  )

  return fillIntervals(rows, ids, interval, limit, dateDetails)
}

const top = (ids, type, range, limit, dateDetails) => {
  const { clause, parameters } = rangeFilter(range, dateDetails)

  return select(
    `
      SELECT
        key,
        ${aggregate(type)} AS count
      FROM {database:Identifier}.actions FINAL
      WHERE eventId IN {ids:Array(String)}
        AND key IS NOT NULL
        ${clause}
      GROUP BY key
      ORDER BY count DESC
      LIMIT {limit:UInt64}
    `,
    { ids, limit, ...parameters },
  )
}

// The MongoDB pipeline sums for NEW whatever the type is
const newest = (ids, limit) =>
  select(
    `
      SELECT
        key,
        coalesce(sum(value), 0) AS count,
        toUnixTimestamp64Milli(min(created)) AS createdAt
      FROM {database:Identifier}.actions FINAL
      WHERE eventId IN {ids:Array(String)}
        AND key IS NOT NULL
      GROUP BY key
      ORDER BY createdAt DESC, key ASC
      LIMIT {limit:UInt64}
    `,
    { ids, limit },
  )

const recent = (ids, limit) =>
  select(
    `
      SELECT
        key,
        toUnixTimestamp64Milli(created) AS createdAt
      FROM {database:Identifier}.actions FINAL
      WHERE eventId IN {ids:Array(String)}
        AND key IS NOT NULL
      ORDER BY createdAt DESC
      LIMIT {limit:UInt64}
    `,
    { ids, limit },
  )

const rows = (ids, sorting, type, range, limit, dateDetails) => {
  if (sorting === SORTINGS_TOP) return top(ids, type, range, limit, dateDetails)
  if (sorting === SORTINGS_NEW) return newest(ids, limit)
  if (sorting === SORTINGS_RECENT) return recent(ids, limit)
}

export const list = async (ids, sorting, type, range, limit, dateDetails) => {
  const entries = await rows(ids, sorting, type, range, limit, dateDetails)

  return entries.map((row) => ({
    id: recursiveId([row.key, sorting, type, range, ...ids]),
    value: row.key,
    count: row.count,
    created: row.createdAt == null ? undefined : new Date(row.createdAt),
  }))
}
