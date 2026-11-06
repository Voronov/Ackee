import matchDomains from '../stages/matchDomains.js'
import sortStable from '../stages/sortStable.js'
import rangeStart from '../utils/rangeStart.js'

export default (ids, properties, range, limit, dateDetails, or) => {
  const aggregation = [
    matchDomains(ids),
    {
      $group: {
        _id: {},
        count: {
          $sum: 1,
        },
      },
    },
    sortStable({ count: -1 }),
    {
      $limit: limit,
    },
  ]

  for (const property of properties) {
    if (or === true) {
      aggregation[0].$match['$or'] = [...(aggregation[0].$match['$or'] || []), { [property]: { $ne: null } }]
    } else {
      aggregation[0].$match[property] = { $ne: null }
    }
    aggregation[1].$group._id[property] = `$${property}`
  }

  const start = rangeStart(range, dateDetails)
  if (start != null) aggregation[0].$match.created = { $gte: start }

  return aggregation
}
