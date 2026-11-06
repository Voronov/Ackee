import { startOfDay } from 'date-fns'
import { getTimezoneOffset } from 'date-fns-tz'

import aggregateDimensionDayRollups from '../aggregations/aggregateDimensionDayRollups.js'
import aggregateDimensionRollups from '../aggregations/aggregateDimensionRollups.js'
import aggregateViewRollups from '../aggregations/aggregateViewRollups.js'
import { DURATIONS_LIMIT } from '../constants/durations.js'
import { ROLLUP_CHUNK_HOURS, ROLLUP_DIMENSIONS, ROLLUP_LEASE } from '../constants/rollups.js'
import DimensionDayRollup from '../models/DimensionDayRollup.js'
import DimensionRollup from '../models/DimensionRollup.js'
import Record from '../models/Record.js'
import RollupState from '../models/RollupState.js'
import ViewRollup from '../models/ViewRollup.js'
import { day, hour } from '../utils/times.js'

const STATE_ID = 'records'

export const floorHour = (date) => new Date(Math.floor(date.getTime() / hour) * hour)
export const ceilHour = (date) => new Date(Math.ceil(date.getTime() / hour) * hour)
// Days in UTC, as the hours of the rollups are
export const floorDay = (date) => new Date(Math.floor(date.getTime() / day) * day)
export const ceilDay = (date) => new Date(Math.ceil(date.getTime() / day) * day)

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
// [until, end) (stages/unionRecords.js). Without an end the window goes on until now; a
// period of the dashboard ends earlier (ACKEE-24).
export const coverage = async (start, timeZone, end) => {
  const state = await RollupState.findById(STATE_ID).lean()
  if (state?.until == null) return

  const from = start == null || start < state.from ? state.from : ceilHour(start)
  const until = end == null || end > state.until ? state.until : floorHour(end)
  if (from >= until) return

  if (timeZone != null && isWholeHourZone(timeZone, [from, until]) === false) return

  // The whole days of [from, until) that have daily rollups. Hourly rollups cover the rest.
  // until may have been moved back by hand (ADR-005), then the days past it do not count.
  const daysUntil = state.daysUntil == null ? null : new Date(Math.min(state.daysUntil, floorDay(until)))
  const days = { from: ceilDay(from), until: daysUntil }
  const hasDays = days.until != null && days.from < days.until

  return { start, from, until, end, ...(hasDays === true && { days }) }
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

const buildDays = async (from, to) => {
  await DimensionDayRollup.deleteMany({ day: { $gte: from, $lt: to } })
  await DimensionRollup.aggregate(aggregateDimensionDayRollups(from, to)).allowDiskUse(true)
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
    let { from, until } = state

    if (until == null) {
      const oldest = await Record.findOne().sort({ created: 1 }).select('created').lean()
      from = oldest == null ? target : new Date(Math.min(floorHour(oldest.created).getTime(), target.getTime()))

      await RollupState.updateOne({ _id: STATE_ID }, { $set: { from, until: from } })
      until = from
    }

    // A day is summed only from hours that are built. When until moved back (hours built again),
    // the days from there on are summed again too, and until then the reports read their hours.
    const daysFrom = ceilDay(from)
    let daysUntil = state.daysUntil ?? daysFrom
    if (daysUntil > floorDay(until)) {
      daysUntil = new Date(Math.max(floorDay(until).getTime(), daysFrom.getTime()))
      await RollupState.updateOne({ _id: STATE_ID, lockedUntil: lease }, { $set: { daysUntil } })
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

    const daysTarget = floorDay(until)

    while (daysUntil < daysTarget) {
      const next = new Date(Math.min(daysUntil.getTime() + ROLLUP_CHUNK_HOURS * hour, daysTarget.getTime()))

      await buildDays(daysUntil, next)
      const renewed = new Date(Date.now() + ROLLUP_LEASE)
      const { matchedCount } = await RollupState.updateOne(
        { _id: STATE_ID, lockedUntil: lease },
        { $set: { daysUntil: next, lockedUntil: renewed } },
      )
      if (matchedCount === 0) return
      lease = renewed
      daysUntil = next
    }

    return RollupState.findById(STATE_ID).select('from until daysUntil').lean()
  } finally {
    await releaseLease(lease)
  }
}

export const del = async (domainId) => {
  await ViewRollup.deleteMany({ domainId })
  await DimensionRollup.deleteMany({ domainId })
  await DimensionDayRollup.deleteMany({ domainId })
}
