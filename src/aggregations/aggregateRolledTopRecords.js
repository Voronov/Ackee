import DimensionRollup from '../models/DimensionRollup.js'
import matchDomains from '../stages/matchDomains.js'
import projectDimensionFacts from '../stages/projectDimensionFacts.js'
import sortStable from '../stages/sortStable.js'
import unionRecords from '../stages/unionRecords.js'

const rollupFacts = { $project: { fields: 1, count: 1 } }

// The hours of the rollups that no daily rollup covers: before the first whole day of the
// window and after the last day that is built (ACKEE-74)
const unionHours = (ids, dimension, coverage) => {
  const match = matchDomains(ids)
  match.$match.dimension = dimension
  match.$match.$or = [
    { hour: { $gte: coverage.from, $lt: coverage.days.from } },
    { hour: { $gte: coverage.days.until, $lt: coverage.until } },
  ]

  return {
    $unionWith: {
      coll: DimensionRollup.collection.collectionName,
      pipeline: [match, rollupFacts],
    },
  }
}

// The list of aggregateTopRecords, read from the rollups of a dimension and the records around them.
// The filter, the grouping and the order are the same, field for field, so both read
// paths return the same list, ties included. With days in the coverage the aggregation runs
// on DimensionDayRollup, otherwise on DimensionRollup.
export default (ids, dimension, dimensionFields, properties, limit, coverage, or) => {
  const aggregation = [
    matchDomains(ids),
    rollupFacts,
    ...(coverage.days == null ? [] : [unionHours(ids, dimension, coverage)]),
    unionRecords(ids, coverage, projectDimensionFacts(dimensionFields)),
    {
      $match: {},
    },
    {
      $group: {
        _id: {},
        count: {
          $sum: '$count',
        },
      },
    },
    sortStable({ count: -1 }),
    {
      $limit: limit,
    },
  ]

  aggregation[0].$match.dimension = dimension
  if (coverage.days == null) {
    aggregation[0].$match.hour = { $gte: coverage.from, $lt: coverage.until }
  } else {
    aggregation[0].$match.day = { $gte: coverage.days.from, $lt: coverage.days.until }
  }

  const filter = aggregation.at(-4)
  const group = aggregation.at(-3)

  for (const property of properties) {
    if (or === true) {
      filter.$match['$or'] = [...(filter.$match['$or'] || []), { [`fields.${property}`]: { $ne: null } }]
    } else {
      filter.$match[`fields.${property}`] = { $ne: null }
    }
    group.$group._id[property] = `$fields.${property}`
  }

  return aggregation
}
