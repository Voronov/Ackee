import matchDomains from '../stages/matchDomains.js'

/*
 * Values ordered by when they first appeared, newest first.
 *
 * `$min` rather than `$first`: `$first` takes whichever document the storage engine hands
 * over first, which is not an order at all. It looked like one for years because a
 * collection scan returns documents in insertion order, so `$first` happened to be the
 * newest record. Adding the compound index on `{ domainId, created }` changed the plan to
 * an index scan, the oldest record arrived first instead, and the report started naming a
 * different value.
 *
 * `$min` says what the schema says: the moment a value was seen for the first time.
 */
export default (ids, properties, limit, or) => {
  const aggregation = [
    matchDomains(ids),
    {
      $group: {
        _id: {},
        count: {
          $sum: 1,
        },
        created: {
          $min: '$created',
        },
      },
    },
    {
      // The grouped properties are the tie-break. Two values that first appeared in the
      // same millisecond would otherwise swap places between runs.
      $sort: {
        created: -1,
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
    aggregation[1].$group._id[property] = `$${property}`
    aggregation[2].$sort[`_id.${property}`] = 1
  }

  return aggregation
}
