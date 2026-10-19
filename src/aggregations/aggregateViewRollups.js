import ViewRollup from '../models/ViewRollup.js'
import projectViewFacts from '../stages/projectViewFacts.js'

export default (from, to) => {
  // Sums the records of [from, to) per domain and hour. $merge writes the result inside the
  // database, so no record passes through the server.
  return [
    {
      $match: {
        created: { $gte: from, $lt: to },
      },
    },
    projectViewFacts(),
    {
      $group: {
        _id: {
          domainId: '$domainId',
          hour: { $dateTrunc: { date: '$at', unit: 'hour' } },
        },
        total: { $sum: '$total' },
        unique: { $sum: '$unique' },
        durationSum: { $sum: '$durationSum' },
        durationCount: { $sum: '$durationCount' },
      },
    },
    {
      $project: {
        _id: 0,
        domainId: '$_id.domainId',
        hour: '$_id.hour',
        total: 1,
        unique: 1,
        durationSum: 1,
        durationCount: 1,
      },
    },
    {
      $merge: {
        into: ViewRollup.collection.collectionName,
        whenNotMatched: 'insert',
      },
    },
  ]
}
