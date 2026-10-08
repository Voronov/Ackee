import aggregateTopRecords from '../aggregations/aggregateTopRecords.js'
import Record from '../models/Record.js'
import { topRecords as fromRollups } from '../rollups/read.js'

// The single point every top report is read through.
//
// Two read paths over the same data, fastest first: hourly rollups, then raw MongoDB
// records as in version 1.0. All three return the same shape, so callers
// do not change.
//
// Rollups decide for themselves whether they can answer. When they do not cover the
// window they return `null` and raw records take over. Rolling back is an environment
// change, not a data migration.
export default async (ids, properties, range, limit, dateDetails, or = false) => {
  const rolled = await fromRollups(ids, properties, range, limit, dateDetails, or)

  if (rolled != null) return rolled

  return Record.aggregate(aggregateTopRecords(ids, properties, range, limit, dateDetails, or))
}
