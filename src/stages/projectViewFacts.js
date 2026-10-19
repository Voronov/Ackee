import { DURATIONS_INTERVAL, DURATIONS_LIMIT } from '../constants/durations.js'

const duration = { $subtract: ['$updated', '$created'] }

// The same rules as projectMinInterval and matchLimit: a visit below the tracking interval
// counts as half of it, and one at or above the limit does not count at all.
const minDuration = {
  $cond: {
    if: { $lt: [duration, DURATIONS_INTERVAL] },
    then: DURATIONS_INTERVAL / 2,
    else: duration,
  },
}

const counts = { $lt: [minDuration, DURATIONS_LIMIT] }

export default () => {
  // What one record adds to the views and durations reports. Rollups sum it per hour, and the
  // reports sum it for the records outside of the rollups, so both read paths count alike.
  return {
    $project: {
      domainId: '$domainId',
      at: '$created',
      total: { $literal: 1 },
      unique: { $cond: [{ $ne: [{ $ifNull: ['$clientId', null] }, null] }, 1, 0] },
      durationSum: { $cond: [counts, minDuration, 0] },
      durationCount: { $cond: [counts, 1, 0] },
    },
  }
}
