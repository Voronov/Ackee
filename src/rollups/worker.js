import schedule from 'node-schedule'

import Domain from '../models/Domain.js'
import Record from '../models/Record.js'
import RollupState from '../models/RollupState.js'
import config from '../utils/config.js'
import { observeRollupBuild, setRollupLag } from '../utils/metrics.js'
import signale from '../utils/signale.js'
import { buildRange, floorHour } from './index.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

// Two hours of overlap: events written late land in a bucket that is already closed, so
// the last hours are recomputed on every pass.
const OVERLAP = 2 * HOUR

const extendState = async (domainId, from, to) => {
  const state = await RollupState.findOne({ domainId })

  await RollupState.updateOne(
    { domainId },
    {
      $set: {
        from: state == null ? from : new Date(Math.min(state.from.getTime(), from.getTime())),
        to: state == null ? to : new Date(Math.max(state.to.getTime(), to.getTime())),
        updated: new Date(),
      },
    },
    { upsert: true },
  )
}

// Builds rollups for a range, one day at a time.
//
// In chunks rather than one query for two reasons: a single `$facet` over months of data
// runs out of memory, and progress is visible. The covered range is extended after each
// chunk, so an interrupted run leaves what it built usable.
const buildChunked = async (domainId, from, to, onProgress, mode = 'refresh') => {
  let cursor = from
  let chunks = 0
  let documents = 0

  while (cursor < to) {
    const next = new Date(Math.min(cursor.getTime() + DAY, to.getTime()))
    const started = Date.now()

    documents += await buildRange(domainId, cursor, next)
    observeRollupBuild(mode, (Date.now() - started) / 1000)
    chunks++

    await extendState(domainId, cursor, next)
    onProgress?.({ chunks, documents, until: next })

    cursor = next
  }

  return { chunks, documents }
}

// Builds everything a domain has.
export const backfill = async (domainId, onProgress) => {
  const oldest = await Record.findOne({ domainId }).sort({ created: 1 }).select('created').lean()

  if (oldest == null) return { chunks: 0, documents: 0 }

  const to = floorHour(new Date())
  const from = new Date(Math.floor(oldest.created.getTime() / DAY) * DAY)

  return buildChunked(domainId, from, to, onProgress, 'backfill')
}

// Incremental update.
//
// The start is the end of the covered range, not simply two hours ago. If the worker was
// down for a while, those hours have to be built too. Otherwise the covered range would
// claim more than was actually computed, and reports would quietly undercount: a missing
// bucket looks exactly like a bucket with no events.
export const refresh = async (domainId) => {
  const to = floorHour(new Date())
  const state = await RollupState.findOne({ domainId }).lean()
  const overlapStart = new Date(to.getTime() - OVERLAP)

  if (state == null) return backfill(domainId)

  const from = new Date(Math.min(state.to.getTime(), overlapStart.getTime()))

  if (from >= to) return { chunks: 0, documents: 0 }

  const gapHours = Math.round((to.getTime() - from.getTime()) / HOUR)
  if (gapHours > 24) signale.warn(`Rollup gap of ${gapHours}h for domain ${domainId}, rebuilding`)

  return buildChunked(domainId, from, to)
}

export const refreshAll = async () => {
  const domains = await Domain.find().select('id').lean()

  for (const domain of domains) {
    try {
      await refresh(domain.id)
    } catch (error) {
      signale.fatal(error)
    }
  }

  // Lag is measured on the worst domain, since that is what decides whether rollups can be trusted.
  const states = await RollupState.find().select('to').lean()
  const worst = states.reduce((acc, state) => Math.min(acc, state.to.getTime()), Date.now())

  setRollupLag(Math.max(0, Math.round((Date.now() - worst) / 1000)))
}

export const start = () => {
  if (config.rollups !== true) return null

  // Every five minutes: a bucket is an hour, so more often is pointless and less often
  // would leave the last hour uncounted for too long.
  const job = schedule.scheduleJob('*/5 * * * *', () => {
    refreshAll().catch(signale.fatal)
  })

  signale.info('Rollup worker enabled')

  return job
}
