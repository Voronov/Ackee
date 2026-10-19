// Whether variant A can answer from rollups right now: A falls back to raw records without
// a word when they do not cover the window up to the current hour, and a measurement of
// A would then measure v1.0. Exits with 1 when they lag behind.
//
//   TZ=UTC ACKEE_MONGODB=mongodb://127.0.0.1:27018/ackee node tools/spike-15/rollups-ready.js [--domain …]
import { startOfDay, subDays, subHours } from 'date-fns'
import path from 'node:path'
import { parseArgs } from 'node:util'

import RollupState from '../../src/models/RollupState.js'
import { floorHour } from '../../src/rollups/dimension.js'
import signale from '../../src/utils/signale.js'
import { connectStand, disconnectStand, requireUtc, resolveDomainId } from './stand.js'

// The widest window of the four reports: views and durations reach 14 hours before the
// first of the 30 days, see includeDays in src/utils/createDate.js
const windowStart = (now) => subHours(subDays(startOfDay(now), 29), 14)

export const rollupProblems = async (domainId, now = new Date()) => {
  const state = await RollupState.findOne({ domainId }).lean()
  if (state == null) return ['no rollups, run the backfill']

  const problems = []

  if (state.from > windowStart(now)) problems.push(`rollups start at ${state.from.toISOString()}, after the window`)
  if (state.to < floorHour(now)) {
    problems.push(`rollups end at ${state.to.toISOString()}, wait for the next pass of the worker of ackee-a`)
  }
  if (state.sealed == null || state.sealed < startOfDay(now)) {
    problems.push(`unique views sealed up to ${state.sealed?.toISOString() ?? 'never'}, before today`)
  }

  return problems
}

// Connects, checks and disconnects; throws with every problem found
export const requireRollups = async (domainId) => {
  requireUtc()
  await connectStand()

  try {
    const problems = await rollupProblems(await resolveDomainId(domainId))
    if (problems.length > 0) throw new Error(`Variant A would read raw records: ${problems.join('; ')}`)
  } finally {
    await disconnectStand()
  }
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename

if (isMain === true) {
  const { values } = parseArgs({ options: { domain: { type: 'string' } } })

  try {
    await requireRollups(values.domain)
    signale.success('Rollups cover the window up to the current hour')
  } catch (error) {
    signale.fatal(error.message)
    process.exit(1)
  }
}
