import matchEvents from '../stages/matchEvents.js'

export default (ids, limit) => {
  const aggregation = [
    matchEvents(ids),
    // Served by the index, so no tie-breaker: with _id in the sort the planner reads the whole domain.
    {
      $sort: {
        created: -1,
      },
    },
    {
      $project: {
        _id: {
          key: '$key',
        },
        created: '$created',
      },
    },
    {
      $limit: limit,
    },
  ]

  aggregation[0].$match.key = { $ne: null }

  return aggregation
}
