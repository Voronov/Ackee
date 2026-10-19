import { REFERRERS_TYPE_WITH_SOURCE } from '../../src/constants/referrers.js'
import { RANGES_LAST_30_DAYS } from '../../src/constants/ranges.js'
import { SORTINGS_TOP } from '../../src/constants/sortings.js'
import { VIEWS_TYPE_UNIQUE } from '../../src/constants/views.js'
import { ceilHour } from '../../src/rollups/dimension.js'
import {
  fillIntervals,
  intervalColumns,
  intervalGroupBy,
  intervalParameters,
} from '../../src/stores/clickhouse/reports/intervals.js'
import select from '../../src/stores/clickhouse/reports/select.js'
import recursiveId from '../../src/utils/recursiveId.js'

/*
 * Variant C of ACKEE-15: the views and referrers reports over hourly materialized views
 * (mv.js), with the same result shape as the ClickHouse store. Not wired into Ackee.
 *
 * Whole hours come from the views, the partial hour at the start of the window from raw
 * records. Rows inserted into `records` reach the views on insert, so no tail is needed.
 * Durations have no view: `updated` changes after the insert (see NOTES.md), so C
 * answers durations exactly as B does.
 */

export const views = async (ids, type, interval, limit, dateDetails) => {
  const from = dateDetails.includeFnByInterval(interval)(limit)
  const unique = type === VIEWS_TYPE_UNIQUE

  const rows = await select(
    `
      SELECT
        ${intervalColumns(interval, dateDetails.userTimeZone)},
        sum(part) AS count
      FROM (
        SELECT toDateTime64(hour, 3, 'UTC') AS created, ${unique ? 'countMerge(uniques)' : 'countMerge(total)'} AS part
        FROM {database:Identifier}.views_hourly
        WHERE domainId IN {ids:Array(String)}
          AND hour >= {hot:DateTime64(3)}
        GROUP BY hour
        UNION ALL
        SELECT created, count() AS part
        FROM {database:Identifier}.records FINAL
        WHERE domainId IN {ids:Array(String)}
          AND created >= {from:DateTime64(3)}
          AND created < {hot:DateTime64(3)}
          ${unique ? "AND clientId != ''" : ''}
        GROUP BY created
      )
      GROUP BY ${intervalGroupBy(interval)}
    `,
    { ids, from, hot: ceilHour(from), ...intervalParameters(dateDetails.userTimeZone) },
  )

  return fillIntervals(rows, ids, interval, limit, dateDetails)
}

// TOP referrers WITH_SOURCE over the last 30 days, the report the dashboard asks for
export const referrers = async (ids, limit, dateDetails) => {
  const from = dateDetails.lastDays(30)

  const rows = await select(
    `
      SELECT source, siteReferrer, sum(part) AS count
      FROM (
        SELECT source, siteReferrer, countMerge(total) AS part
        FROM {database:Identifier}.referrers_hourly
        WHERE domainId IN {ids:Array(String)}
          AND hour >= {hot:DateTime64(3)}
        GROUP BY source, siteReferrer
        UNION ALL
        SELECT source, siteReferrer, count() AS part
        FROM {database:Identifier}.records FINAL
        WHERE domainId IN {ids:Array(String)}
          AND (source IS NOT NULL OR siteReferrer IS NOT NULL)
          AND created >= {from:DateTime64(3)}
          AND created < {hot:DateTime64(3)}
        GROUP BY source, siteReferrer
      )
      GROUP BY source, siteReferrer
      ORDER BY count DESC
      LIMIT {limit:UInt64}
    `,
    { ids, from, hot: ceilHour(from), limit },
  )

  return rows.map((row) => {
    const value = row.source || row.siteReferrer

    return {
      id: recursiveId([value, SORTINGS_TOP, REFERRERS_TYPE_WITH_SOURCE, RANGES_LAST_30_DAYS, ...ids]),
      value,
      count: row.count,
      created: undefined,
    }
  })
}
