import schedule from 'node-schedule'

import { rollUp } from '../database/rollups.js'
import * as ingestQueue from '../queue/redis.js'
import signale from './signale.js'

// Events still waiting in the ingest queue are not in the records yet, so they hold the seal
// back (ADR-006). Null when nothing waits.
const pendingSince = () => (ingestQueue.isEnabled() === true ? ingestQueue.oldest() : null)

// When a run last finished without an error, read by /metrics. Zero where the job does not run.
export const stats = { lastSuccess: 0 }

export const run = async () => {
  let since

  try {
    since = await pendingSince()
  } catch (error) {
    // Without the oldest waiting event a run could seal hours that are about to get records
    signale.warn(`Skipping rollups, the ingest queue is unreachable: ${error.message}`)
    return
  }

  try {
    const state = await rollUp(new Date(), since)
    // Nothing back means another process holds the lease, which is not a failure of this one
    stats.lastSuccess = Date.now()
    if (state != null) signale.info(`Rollups cover ${state.from.toISOString()} to ${state.until.toISOString()}`)
  } catch (error) {
    // Reports read the records the rollups miss, so a failed run only makes them slower
    signale.warn(`Could not build rollups: ${error.message}`)
  }
}

// Hours are sealed one by one (sealedUntil in database/rollups.js), so a run every few minutes
// keeps the records the reports read on top of the rollups to less than a day.
// The first run also builds the rollups of all records stored before rollups existed.
export const start = () => {
  // The alert waits an hour from the start, not from 1970
  stats.lastSuccess = Date.now()
  run()
  return schedule.scheduleJob('*/10 * * * *', run)
}
