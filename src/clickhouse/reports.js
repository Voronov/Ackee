import {
  RANGES_LAST_24_HOURS,
  RANGES_LAST_30_DAYS,
  RANGES_LAST_6_MONTHS,
  RANGES_LAST_7_DAYS,
} from '../constants/ranges.js'
import { DURATIONS_INTERVAL, DURATIONS_LIMIT } from '../constants/durations.js'
import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import Record from '../models/Record.js'
import config from '../utils/config.js'
import { getClient, isEnabled } from '../utils/clickhouse.js'
import signale from '../utils/signale.js'

// ReplacingMergeTree keeps duplicates until parts merge, and extending a visit inserts
// the row again. Without FINAL a report would count the same visit twice. Monthly
// partitions keep the deduplication inside one partition.
const SETTINGS = { do_not_merge_across_partitions_select_final: 1 }

const canRead = () => isEnabled() === true && config.clickhouseReads === true

const toDateTime = (value) => new Date(value).toISOString().replace('T', ' ').replace('Z', '')

const rangeStart = (range, dateDetails) => {
  if (range === RANGES_LAST_24_HOURS) return dateDetails.lastHours(24)
  if (range === RANGES_LAST_7_DAYS) return dateDetails.lastDays(7)
  if (range === RANGES_LAST_30_DAYS) return dateDetails.lastDays(30)
  if (range === RANGES_LAST_6_MONTHS) return dateDetails.lastMonths(6)
  return null
}

const query = async (sql, parameters) => {
  const result = await getClient().query({
    query: sql,
    query_params: parameters,
    format: 'JSONEachRow',
    clickhouse_settings: SETTINGS,
  })

  return result.json()
}

/*
 * Whether the columnar store covers the requested window.
 *
 * While dual-write runs without a backfill, ClickHouse only holds events written since it
 * was switched on, and a 30-day report would quietly undercount.
 *
 * The question is not "is there data for the whole window" — there may be none in MongoDB
 * either, if the domain is younger. The question is whether ClickHouse has everything
 * MongoDB has, so the oldest event is compared against the source of truth as well.
 */
const isCovered = async (ids, from) => {
  const rows = await query(
    `SELECT min(created) AS oldest, count() AS total FROM records WHERE domainId IN {ids:Array(UUID)}`,
    { ids },
  )

  const [row] = rows

  if (row == null || Number(row.total) === 0) return false

  const oldest = new Date(`${row.oldest}Z`)

  if (oldest <= from) return true

  // The compound index makes this a single index seek.
  const [source] = await Record.find({ domainId: { $in: ids } })
    .sort({ created: 1 })
    .limit(1)
    .select('created')
    .lean()

  return source == null || oldest <= source.created
}

const presence = (properties, or) =>
  or === true
    ? `(${properties.map((property) => `${property} IS NOT NULL`).join(' OR ')})`
    : properties.map((property) => `${property} IS NOT NULL`).join(' AND ')

/*
 * Top reports: grouping by an arbitrary set of fields.
 *
 * The sort order mirrors aggregateTopRecords, secondary key included. Without it the rows
 * at the `LIMIT` cut-off would be non-deterministic (D-001).
 */
export const topRecords = async (ids, properties, range, limit, dateDetails, or = false) => {
  if (canRead() === false || properties.length === 0) return null

  const from = rangeStart(range, dateDetails)
  if (from == null) return null

  try {
    if ((await isCovered(ids, from)) === false) return null

    const columns = properties.join(', ')
    const rows = await query(
      `SELECT ${columns}, count() AS count
       FROM records FINAL
       WHERE domainId IN {ids:Array(UUID)} AND created >= {from:DateTime64(3)} AND ${presence(properties, or)}
       GROUP BY ${columns}
       ORDER BY count DESC, ${properties.map((property) => `${property} ASC`).join(', ')}
       LIMIT {limit:UInt32}`,
      { ids, from: toDateTime(from), limit },
    )

    return rows.map((row) => ({
      _id: Object.fromEntries(properties.map((property) => [property, row[property] ?? null])),
      count: Number(row.count),
    }))
  } catch (error) {
    // An unavailable columnar store must not break a report: MongoDB answers instead.
    signale.fatal(`ClickHouse read failed: ${error.message}`)
    return null
  }
}

const intervalColumns = (interval) => {
  const parts = []

  if (interval === INTERVALS_DAILY) parts.push(['day', `toDayOfMonth(created, {tz:String})`])
  if ([INTERVALS_DAILY, INTERVALS_MONTHLY].includes(interval)) parts.push(['month', `toMonth(created, {tz:String})`])
  if ([INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY].includes(interval)) {
    parts.push(['year', `toYear(created, {tz:String})`])
  }

  return parts
}

// Total views. Unique views stay with MongoDB: their meaning depends on erasing the hash
// from older records, and the hash is never copied here.
export const views = async (ids, interval, limit, dateDetails) => {
  if (canRead() === false) return null

  const from = dateDetails.includeFnByInterval(interval)(limit)

  try {
    if ((await isCovered(ids, from)) === false) return null

    const parts = intervalColumns(interval)
    const select = parts.map(([name, expression]) => `${expression} AS ${name}`).join(', ')
    const group = parts.map(([name]) => name).join(', ')

    const rows = await query(
      `SELECT ${select}, count() AS count
       FROM records FINAL
       WHERE domainId IN {ids:Array(UUID)} AND created >= {from:DateTime64(3)}
       GROUP BY ${group}`,
      { ids, from: toDateTime(from), tz: dateDetails.userTimeZone },
    )

    return rows.map((row) => ({
      _id: Object.fromEntries(parts.map(([name]) => [name, Number(row[name])])),
      count: Number(row.count),
    }))
  } catch (error) {
    signale.fatal(`ClickHouse read failed: ${error.message}`)
    return null
  }
}

/*
 * Visit durations: the report this store was introduced for.
 *
 * To read two eight-byte fields, MongoDB has to load the whole 555-byte document. Here it
 * reads two columns.
 *
 * The transforms mirror projectMinInterval and matchLimit: visits shorter than the tracking
 * interval are raised to half of it, and anything over half an hour is dropped as a
 * background tab.
 */
export const durations = async (ids, interval, limit, dateDetails) => {
  if (canRead() === false) return null

  const from = dateDetails.includeFnByInterval(interval)(limit)

  try {
    if ((await isCovered(ids, from)) === false) return null

    const parts = intervalColumns(interval)
    const select = parts.map(([name, expression]) => `${expression} AS ${name}`).join(', ')
    const group = parts.map(([name]) => name).join(', ')

    const rows = await query(
      `SELECT ${select}, avg(duration) AS count
       FROM (
         SELECT created,
                if(raw < {minimum:UInt32}, {half:UInt32}, raw) AS duration
         FROM (
           SELECT created, dateDiff('millisecond', created, updated) AS raw
           FROM records FINAL
           WHERE domainId IN {ids:Array(UUID)} AND created >= {from:DateTime64(3)}
         )
       )
       WHERE duration < {maximum:UInt32}
       GROUP BY ${group}`,
      {
        ids,
        from: toDateTime(from),
        tz: dateDetails.userTimeZone,
        minimum: DURATIONS_INTERVAL,
        half: DURATIONS_INTERVAL / 2,
        maximum: DURATIONS_LIMIT,
      },
    )

    return rows.map((row) => ({
      _id: Object.fromEntries(parts.map(([name]) => [name, Number(row[name])])),
      count: Number(row.count),
    }))
  } catch (error) {
    signale.fatal(`ClickHouse read failed: ${error.message}`)
    return null
  }
}
