import matchDomains from '../stages/matchDomains.js'
import sortStable from '../stages/sortStable.js'

export default (ids, properties, limit, or) => {
  const aggregation = [
    matchDomains(ids),
    sortStable({ created: -1 }),
    {
      $project: {
        _id: {},
        created: '$created',
      },
    },
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
    aggregation[2].$project._id[property] = `$${property}`
  }

  return aggregation
}
