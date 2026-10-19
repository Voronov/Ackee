import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import matchDomains from '../stages/matchDomains.js'
import projectViewFacts from '../stages/projectViewFacts.js'
import unionRecords from '../stages/unionRecords.js'

// The rollups of the covered hours and the records around them, in the shape of
// projectViewFacts. Grouped like aggregateViews and aggregateDurations group records.
export default (ids, interval, dateDetails, coverage, accumulators) => {
  const aggregation = [
    matchDomains(ids),
    {
      $project: {
        at: '$hour',
        total: 1,
        unique: 1,
        durationSum: 1,
        durationCount: 1,
      },
    },
    unionRecords(ids, coverage, projectViewFacts()),
    {
      $group: {
        _id: {},
        ...accumulators,
      },
    },
  ]

  aggregation[0].$match.hour = { $gte: coverage.from, $lt: coverage.until }

  const dateExpression = { date: '$at', timezone: dateDetails.userTimeZone }
  const matchDay = [INTERVALS_DAILY].includes(interval)
  const matchMonth = [INTERVALS_DAILY, INTERVALS_MONTHLY].includes(interval)
  const matchYear = [INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY].includes(interval)

  if (matchDay === true) aggregation[3].$group._id.day = { $dayOfMonth: dateExpression }
  if (matchMonth === true) aggregation[3].$group._id.month = { $month: dateExpression }
  if (matchYear === true) aggregation[3].$group._id.year = { $year: dateExpression }

  return aggregation
}
