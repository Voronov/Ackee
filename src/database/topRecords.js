import aggregateTopRecords from '../aggregations/aggregateTopRecords.js'
import { topRecords as fromClickhouse } from '../clickhouse/reports.js'
import Record from '../models/Record.js'
import { topRecords as fromRollups } from '../rollups/read.js'

// The single point every top report is read through.
//
// Three read paths over the same data, fastest first: the columnar store, hourly rollups,
// then raw MongoDB records as in version 1.0. All three return the same shape, so callers
// do not change.
//
// Each path decides for itself whether it can answer. A store that does not cover the
// window returns `null` and the next one takes over. Rolling back is an environment
// change, not a data migration.
export default async (ids, properties, range, limit, dateDetails, or = false) => {
  const columnar = await fromClickhouse(ids, properties, range, limit, dateDetails, or)

  if (columnar != null) return columnar

  const rolled = await fromRollups(ids, properties, range, limit, dateDetails, or)

  if (rolled != null) return rolled

  return Record.aggregate(aggregateTopRecords(ids, properties, range, limit, dateDetails, or))
}
