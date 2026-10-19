import matchDomains from '../stages/matchDomains.js'
import sortStable from '../stages/sortStable.js'

export default (ids, properties, limit, or) => {
  const aggregation = [
    matchDomains(ids),
    {
      $group: {
        _id: {},
        count: {
          $sum: 1,
        },
        // When an entry was first seen. $first would take whichever document the plan reads first.
        created: {
          $min: '$created',
        },
      },
    },
    sortStable({ created: -1 }),
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

  return aggregation
}
