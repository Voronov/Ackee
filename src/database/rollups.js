import { startOfDay } from 'date-fns'
import { getTimezoneOffset } from 'date-fns-tz'

import aggregateDimensionRollups from '../aggregations/aggregateDimensionRollups.js'
import aggregateViewRollups from '../aggregations/aggregateViewRollups.js'
import { DURATIONS_LIMIT } from '../constants/durations.js'
import { ROLLUP_CHUNK_HOURS, ROLLUP_DIMENSIONS, ROLLUP_LEASE } from '../constants/rollups.js'
import DimensionRollup from '../models/DimensionRollup.js'
import Record from '../models/Record.js'
import RollupState from '../models/RollupState.js'
import ViewRollup from '../models/ViewRollup.js'
import { hour } from '../utils/times.js'

const STATE_ID = 'records'

export const floorHour = (date) => new Date(Math.floor(date.getTime() / hour) * hour)
export const ceilHour = (date) => new Date(Math.ceil(date.getTime() / hour) * hour)

// The end of the hours whose records can no longer change. Until a visit is over its duration
// grows, and until the salt changes at midnight (utils/salt.js, server time) a new visit can
// anonymize the earlier records of the same visitor. Rolled up any earlier, an hour would keep
// numbers that the records no longer have.
//
// An event still waiting in the ingest queue (ADR-006) is not in the records yet, so the hours
// are sealed as if the time were still that of the oldest one.
export const sealedUntil = (now, pendingSince) => {
  const at = pendingSince == null ? now : new Date(Math.min(now.getTime(), pendingSince.getTime()))
  const visitsOver = at.getTime() - DURATIONS_LIMIT
  return floorHour(new Date(Math.min(visitsOver, startOfDay(at).getTime())))
}

// Hours are summed into days in the time zone of the viewer. That only works when no hour
// is split between two days, which is the case for every offset of whole hours.
const isWholeHourZone = (timeZone, dates) => {
  return dates.every((date) => getTimezoneOffset(timeZone, date) % hour === 0)
}

// Which part of a report window the rollups answer. Null means they cannot, and the report
// reads records only. Otherwise rollups cover [from, until), records [start, from) and
// everything from until on (stages/unionRecords.js).
export const coverage = async (start, timeZone) => {
  const state = await RollupState.findById(STATE_ID).lean()
  if (state?.until == null) return

  const from = start == null || start < state.from ? state.from : ceilHour(start)
  if (from >= state.until) return

  if (timeZone != null && isWholeHourZone(timeZone, [from, state.until]) === false) return

  return { start, from, until: state.until }
}

const buildRange = async (from, to) => {
  // Deleted first, so building a range twice gives the same rollups
  await ViewRollup.deleteMany({ hour: { $gte: from, $lt: to } })
  await DimensionRollup.deleteMany({ hour: { $gte: from, $lt: to } })

  await Record.aggregate(aggregateViewRollups(from, to)).allowDiskUse(true)

  for (const [dimension, fields] of Object.entries(ROLLUP_DIMENSIONS)) {
    await Record.aggregate(aggregateDimensionRollups(dimension, fields, from, to)).allowDiskUse(true)
  }
}

const acquireLease = async () => {
  const now = new Date()

  try {
    return await RollupState.findOneAndUpdate(
      { _id: STATE_ID, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + ROLLUP_LEASE) } },
      { upsert: true, returnDocument: 'after' },
    ).lean()
  } catch (error) {
    // Another process holds the lease: the upsert found no free document and the id is taken
    if (error.code === 11000) return
    throw error
  }
}

// Only the lease this run holds. One taken over after ours ran out belongs to another process.
const releaseLease = (lease) =>
  RollupState.updateOne({ _id: STATE_ID, lockedUntil: lease }, { $set: { lockedUntil: null } })

// Rolls up every sealed hour that is not rolled up yet, one chunk at a time. The covered range
// grows after each chunk, so an interrupted run keeps what it built and the next one goes on
// from there. Returns the covered range, or nothing when another process is building.
// pendingSince is the time of the oldest event still in the ingest queue.
export const rollUp = async (now = new Date(), pendingSince) => {
  const state = await acquireLease()
  if (state == null) return

  let lease = state.lockedUntil

  try {
    const target = sealedUntil(now, pendingSince)
    let until = state.until

    if (until == null) {
      const oldest = await Record.findOne().sort({ created: 1 }).select('created').lean()
      const from = oldest == null ? target : new Date(Math.min(floorHour(oldest.created).getTime(), target.getTime()))

      await RollupState.updateOne({ _id: STATE_ID }, { $set: { from, until: from } })
      until = from
    }

    while (until < target) {
      const next = new Date(Math.min(until.getTime() + ROLLUP_CHUNK_HOURS * hour, target.getTime()))

      await buildRange(until, next)
      // A backfill takes longer than one lease, so every chunk renews it. A lease that ran out
      // and went to another process is not ours to renew: that process goes on from here.
      const renewed = new Date(Date.now() + ROLLUP_LEASE)
      const { matchedCount } = await RollupState.updateOne(
        { _id: STATE_ID, lockedUntil: lease },
        { $set: { until: next, lockedUntil: renewed } },
      )
      if (matchedCount === 0) return
      lease = renewed
      until = next
    }

    return RollupState.findById(STATE_ID).select('from until').lean()
  } finally {
    await releaseLease(lease)
  }
}

export const del = async (domainId) => {
  await ViewRollup.deleteMany({ domainId })
  await DimensionRollup.deleteMany({ domainId })
}
