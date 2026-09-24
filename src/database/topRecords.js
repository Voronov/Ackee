import aggregateTopRecords from '../aggregations/aggregateTopRecords.js'
import Record from '../models/Record.js'
import { topRecords as fromRollups } from '../rollups/read.js'

// The single point every top report is read through.
//
// Two read paths over the same data, fastest first: hourly rollups, then raw MongoDB
// records as in version 1.0. Both return the same shape, so callers do not change.
//
// Each path decides for itself whether it can answer. A path that does not cover the
// window returns `null` and the next one takes over. Reading from ClickHouse instead is
// a choice made above this module, by the event store.
export default async (ids, properties, range, limit, dateDetails, or = false) => {
  const rolled = await fromRollups(ids, properties, range, limit, dateDetails, or)

  if (rolled != null) return rolled

  return Record.aggregate(aggregateTopRecords(ids, properties, range, limit, dateDetails, or))
}
