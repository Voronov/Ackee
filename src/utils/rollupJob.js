import schedule from 'node-schedule'

import { rollUp } from '../database/rollups.js'
import signale from './signale.js'

const run = async () => {
  try {
    const state = await rollUp()
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
  run()
  return schedule.scheduleJob('*/10 * * * *', run)
}
