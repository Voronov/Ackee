import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import matchDomains from '../stages/matchDomains.js'
import projectViewFacts from '../stages/projectViewFacts.js'
import unionRecords from '../stages/unionRecords.js'

// The rollups of the covered hours and the records around them, in the shape of
// projectViewFacts. Grouped like aggregateViews and aggregateDurations group records.
// With `filtered` they are the rollups of one dimension, narrowed to the values of the filters,
// and the records around them are narrowed the same way (BUG-72).
export default (ids, interval, dateDetails, coverage, accumulators, filtered) => {
  const aggregation = [
    matchDomains(ids),
    {
      $project: {
        at: '$hour',
        // The rollups of a dimension call the views count
        total: filtered == null ? 1 : '$count',
        unique: 1,
        durationSum: 1,
        durationCount: 1,
      },
    },
    unionRecords(
      ids,
      coverage,
      projectViewFacts(),
      (filtered?.filters ?? []).map(({ field, value }) => ({ [field]: value })),
    ),
    {
      $group: {
        _id: {},
        ...accumulators,
      },
    },
  ]

  aggregation[0].$match.hour = { $gte: coverage.from, $lt: coverage.until }
  if (filtered != null) {
    aggregation[0].$match.dimension = filtered.dimension
    for (const { field, value } of filtered.filters) aggregation[0].$match[`fields.${field}`] = value
  }

  const dateExpression = { date: '$at', timezone: dateDetails.userTimeZone }
  const matchDay = [INTERVALS_DAILY].includes(interval)
  const matchMonth = [INTERVALS_DAILY, INTERVALS_MONTHLY].includes(interval)
  const matchYear = [INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY].includes(interval)

  if (matchDay === true) aggregation[3].$group._id.day = { $dayOfMonth: dateExpression }
  if (matchMonth === true) aggregation[3].$group._id.month = { $month: dateExpression }
  if (matchYear === true) aggregation[3].$group._id.year = { $year: dateExpression }

  return aggregation
}
