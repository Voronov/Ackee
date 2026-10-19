import matchEvents from '../stages/matchEvents.js'
import sortStable from '../stages/sortStable.js'

export default (ids, limit) => {
  const aggregation = [
    matchEvents(ids),
    {
      $group: {
        _id: {
          key: '$key',
        },
        count: {
          $sum: '$value',
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

  aggregation[0].$match.key = { $ne: null }

  return aggregation
}
