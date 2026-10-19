import aggregateNewRecords from '../aggregations/aggregateNewRecords.js'
import aggregateRecentRecords from '../aggregations/aggregateRecentRecords.js'
import aggregateRolledTopRecords from '../aggregations/aggregateRolledTopRecords.js'
import aggregateTopRecords from '../aggregations/aggregateTopRecords.js'
import { ROLLUP_DIMENSIONS } from '../constants/rollups.js'
import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../constants/sortings.js'
import DimensionRollup from '../models/DimensionRollup.js'
import Record from '../models/Record.js'
import rangeStart from '../utils/rangeStart.js'
import recursiveId from '../utils/recursiveId.js'
import { coverage as rollupCoverage } from './rollups.js'

/*
 * Builds the query for one dimension of the statistics, like browsers or sizes.
 * Every type of the dimension says which record fields it groups by and how a group
 * is shown. `or` groups records that have any of the fields instead of all of them.
 * `dimension` names the rollup of the dimension (constants/rollups.js), which answers TOP.
 */
export default (types, dimension) => async (ids, sorting, type, range, limit, dateDetails) => {
  const { fields, format, or } = types[type]

  const dimensionFields = ROLLUP_DIMENSIONS[dimension] ?? []
  const isRolledUp = sorting === SORTINGS_TOP && fields.every((field) => dimensionFields.includes(field))
  const coverage = isRolledUp === true ? await rollupCoverage(rangeStart(range, dateDetails)) : undefined

  const aggregation = (() => {
    if (coverage != null) {
      return aggregateRolledTopRecords(ids, dimension, dimensionFields, fields, limit, coverage, or)
    }
    if (sorting === SORTINGS_TOP) return aggregateTopRecords(ids, fields, range, limit, dateDetails, or)
    if (sorting === SORTINGS_NEW) return aggregateNewRecords(ids, fields, limit, or)
    if (sorting === SORTINGS_RECENT) return aggregateRecentRecords(ids, fields, limit, or)
  })()

  const model = coverage == null ? Record : DimensionRollup
  const entries = await model.aggregate(aggregation)

  return entries.map((entry) => {
    const value = format(entry._id)

    return {
      id: recursiveId([value, sorting, type, range, ...ids]),
      value,
      count: entry.count,
      created: entry.created,
    }
  })
}
