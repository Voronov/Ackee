import DimensionRollup from '../models/DimensionRollup.js'
import projectDimensionFacts from '../stages/projectDimensionFacts.js'

export default (dimension, fields, from, to) => {
  // Counts the records of [from, to) per domain, hour and combination of the dimension's fields
  return [
    {
      $match: {
        created: { $gte: from, $lt: to },
      },
    },
    projectDimensionFacts(fields),
    {
      $group: {
        _id: {
          domainId: '$domainId',
          hour: { $dateTrunc: { date: '$at', unit: 'hour' } },
          fields: '$fields',
        },
        count: { $sum: '$count' },
      },
    },
    {
      $project: {
        _id: 0,
        domainId: '$_id.domainId',
        dimension: { $literal: dimension },
        hour: '$_id.hour',
        fields: '$_id.fields',
        count: 1,
      },
    },
    {
      $merge: {
        into: DimensionRollup.collection.collectionName,
        whenNotMatched: 'insert',
      },
    },
  ]
}
