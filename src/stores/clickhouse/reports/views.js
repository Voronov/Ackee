import { VIEWS_TYPE_UNIQUE } from '../../../constants/views.js'
import { fillIntervals, intervalColumns, intervalGroupBy, intervalParameters } from './intervals.js'
import select from './select.js'

// Unique views count the records that still carry a clientId: after anonymization
// that is the last record of each visitor, in both stores
export default async (ids, type, interval, limit, dateDetails) => {
  const rows = await select(
    `
      SELECT
        ${intervalColumns(interval, dateDetails.userTimeZone)},
        count() AS count
      FROM {database:Identifier}.records FINAL
      WHERE domainId IN {ids:Array(String)}
        AND created >= {from:DateTime64(3)}
        ${type === VIEWS_TYPE_UNIQUE ? "AND clientId != ''" : ''}
      GROUP BY ${intervalGroupBy(interval)}
    `,
    { ids, from: dateDetails.includeFnByInterval(interval)(limit), ...intervalParameters(dateDetails.userTimeZone) },
  )

  return fillIntervals(rows, ids, interval, limit, dateDetails)
}
