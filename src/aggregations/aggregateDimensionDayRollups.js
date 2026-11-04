import DimensionDayRollup from '../models/DimensionDayRollup.js'

export default (from, to) => {
  // Sums the hourly rollups of [from, to) per domain, dimension, day and combination of fields
  return [
    {
      $match: {
        hour: { $gte: from, $lt: to },
      },
    },
    {
      $group: {
        _id: {
          domainId: '$domainId',
          dimension: '$dimension',
          day: { $dateTrunc: { date: '$hour', unit: 'day' } },
          fields: '$fields',
        },
        count: { $sum: '$count' },
      },
    },
    {
      $project: {
        _id: 0,
        domainId: '$_id.domainId',
        dimension: '$_id.dimension',
        day: '$_id.day',
        fields: '$_id.fields',
        count: 1,
      },
    },
    {
      $merge: {
        into: DimensionDayRollup.collection.collectionName,
        whenNotMatched: 'insert',
      },
    },
  ]
}
