import { DURATIONS_INTERVAL, DURATIONS_LIMIT } from '../../../constants/durations.js'
import select from './select.js'

// Same window as src/aggregations/aggregateActiveVisitors.js: visitors whose last
// record was created within the duration limit and touched within two tracking
// intervals, counted on records that still carry a clientId
export default async (ids, dateDetails) => {
  const [row] = await select(
    `
      SELECT count() AS count
      FROM {database:Identifier}.records FINAL
      WHERE domainId IN {ids:Array(String)}
        AND clientId != ''
        AND created >= {created:DateTime64(3)}
        AND updated >= {updated:DateTime64(3)}
    `,
    {
      ids,
      created: dateDetails.lastMilliseconds(DURATIONS_LIMIT),
      updated: dateDetails.lastMilliseconds(DURATIONS_INTERVAL * 2),
    },
  )

  return row.count
}
