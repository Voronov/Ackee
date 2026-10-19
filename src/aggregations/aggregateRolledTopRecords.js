import matchDomains from '../stages/matchDomains.js'
import projectDimensionFacts from '../stages/projectDimensionFacts.js'
import sortStable from '../stages/sortStable.js'
import unionRecords from '../stages/unionRecords.js'

// The list of aggregateTopRecords, read from the rollups of a dimension and the records around them.
// The filter, the grouping and the order are the same, field for field, so both read
// paths return the same list, ties included.
export default (ids, dimension, dimensionFields, properties, limit, coverage, or) => {
  const aggregation = [
    matchDomains(ids),
    {
      $project: {
        fields: 1,
        count: 1,
      },
    },
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
  aggregation[0].$match.hour = { $gte: coverage.from, $lt: coverage.until }

  for (const property of properties) {
    if (or === true) {
      aggregation[3].$match['$or'] = [
        ...(aggregation[3].$match['$or'] || []),
        { [`fields.${property}`]: { $ne: null } },
      ]
    } else {
      aggregation[3].$match[`fields.${property}`] = { $ne: null }
    }
    aggregation[4].$group._id[property] = `$fields.${property}`
  }

  return aggregation
}
