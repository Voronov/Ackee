import { DURATIONS_INTERVAL, DURATIONS_LIMIT } from '../../../constants/durations.js'
import { fillIntervals, intervalColumns, intervalGroupBy, intervalParameters } from './intervals.js'
import select from './select.js'

// Same steps as src/stages/projectDuration.js, projectMinInterval.js and matchLimit.js,
// in that order: the minimum is applied before the upper limit drops long visits.
// sum / count instead of avg() so the float is the same one MongoDB's $avg computes
// from an exact integer sum.
export default async (ids, interval, limit, dateDetails) => {
  const rows = await select(
    `
      WITH
        toUnixTimestamp64Milli(updated) - toUnixTimestamp64Milli(created) AS elapsed,
        if(elapsed < {interval:Int64}, {minimum:Int64}, elapsed) AS duration
      SELECT
        ${intervalColumns(interval, dateDetails.userTimeZone)},
        sum(duration) / count() AS count
      FROM {database:Identifier}.records FINAL
      WHERE domainId IN {ids:Array(String)}
        AND created >= {from:DateTime64(3)}
        AND duration < {maximum:Int64}
      GROUP BY ${intervalGroupBy(interval)}
    `,
    {
      ids,
      from: dateDetails.includeFnByInterval(interval)(limit),
      ...intervalParameters(dateDetails.userTimeZone),
      interval: DURATIONS_INTERVAL,
      minimum: DURATIONS_INTERVAL / 2,
      maximum: DURATIONS_LIMIT,
    },
  )

  return fillIntervals(rows, ids, interval, limit, dateDetails)
}
