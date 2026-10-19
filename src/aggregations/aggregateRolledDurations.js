import aggregateRolledFacts from './aggregateRolledFacts.js'

// The durations of aggregateDurations, read from rollups. The average is taken only after the hours are summed,
// and a period without a single counted visit is left out, as aggregateDurations leaves it.
export default (ids, interval, dateDetails, coverage) => {
  return [
    ...aggregateRolledFacts(ids, interval, dateDetails, coverage, {
      durationSum: { $sum: '$durationSum' },
      durationCount: { $sum: '$durationCount' },
    }),
    {
      $match: {
        durationCount: { $gt: 0 },
      },
    },
    {
      $project: {
        count: { $divide: ['$durationSum', '$durationCount'] },
      },
    },
  ]
}
