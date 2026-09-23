import matchEvents from '../stages/matchEvents.js'

/*
 * Keys ordered by when they first appeared, newest first.
 *
 * `$min` rather than `$first`, for the reason given in aggregateNewRecords.js: `$first`
 * takes whichever document the storage engine hands over first. The compound index on
 * `{ eventId, created }` turns that into an index scan, so the oldest record arrives
 * first and the report names a different key.
 */
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
        created: {
          $min: '$created',
        },
      },
    },
    {
      // The grouped key is the tie-break. Two keys that first appeared in the same
      // millisecond would otherwise swap places between runs.
      $sort: {
        'created': -1,
        '_id.key': 1,
      },
    },
    {
      $limit: limit,
    },
  ]

  aggregation[0].$match.key = { $ne: null }

  return aggregation
}
