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
import { applyScope, hasFilters } from '../utils/scope.js'
import { FILTER_NAMES } from '../constants/filters.js'
import { coverage as rollupCoverage } from './rollups.js'

/*
 * Builds the query for one dimension of the statistics, like browsers or sizes.
 * Every type of the dimension says which record fields it groups by and how a group
 * is shown. `or` groups records that have any of the fields instead of all of them.
 * `dimension` names the rollup of the dimension (constants/rollups.js), which answers TOP.
 * `details` adds fields of the group to an entry, next to the shown value. `filter` names the
 * fields a click on the entry filters by, all of `fields` when left out.
 */
export default (types, dimension) => async (ids, sorting, type, range, limit, dateDetails) => {
  const { fields, format, details, or, filter } = types[type]

  const dimensionFields = ROLLUP_DIMENSIONS[dimension] ?? []
  // Rollups count whole domains, a filtered list reads records (ACKEE-24)
  const isRolledUp =
    sorting === SORTINGS_TOP &&
    fields.every((field) => dimensionFields.includes(field)) &&
    hasFilters(dateDetails) === false
  const coverage =
    isRolledUp === true ? await rollupCoverage(rangeStart(range, dateDetails), undefined, dateDetails.end) : undefined

  const aggregation = (() => {
    if (coverage != null) {
      return aggregateRolledTopRecords(ids, dimension, dimensionFields, fields, limit, coverage, or)
    }
    if (sorting === SORTINGS_TOP)
      return applyScope(aggregateTopRecords(ids, fields, range, limit, dateDetails, or), dateDetails)
    if (sorting === SORTINGS_NEW) return applyScope(aggregateNewRecords(ids, fields, limit, or), dateDetails)
    if (sorting === SORTINGS_RECENT) return applyScope(aggregateRecentRecords(ids, fields, limit, or), dateDetails)
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
      // The fields of the group, for the dashboard to filter by them (ACKEE-24)
      filter: (filter?.(entry._id) ?? fields).map((field) => ({
        field: FILTER_NAMES[field],
        value: entry._id[field] ?? null,
      })),
      ...details?.(entry._id),
    }
  })
}
