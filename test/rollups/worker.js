import test from 'ava'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import Rollup from '../../src/models/Rollup.js'
import RollupState from '../../src/models/RollupState.js'
import { floorHour } from '../../src/rollups/dimension.js'
import { backfill, refresh, refreshAll, start } from '../../src/rollups/worker.js'

const HOUR = 3_600_000

const mongoDb = MongoMemoryServer.create()

const seed = async (domainId, hoursBack) => {
  const now = Date.now()

  await Record.insertMany(
    Array.from({ length: hoursBack }, (_, index) => {
      const created = new Date(now - (index + 0.5) * HOUR)

      return {
        domainId,
        siteLocation: `https://example.com/${index % 3}`,
        created,
        updated: created,
      }
    }),
  )
}

test.before(async () => {
  const { default: connect } = await import('../../src/utils/connect.js')
  await connect((await mongoDb).getUri())
})

test.after.always(async () => {
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

test("backfill covers a domain's whole history", async (t) => {
  const domainId = uuid()
  await seed(domainId, 30)

  const { documents } = await backfill(domainId)
  const state = await RollupState.findOne({ domainId }).lean()

  t.true(documents > 0)
  t.is(state.to.getTime(), floorHour(new Date()).getTime())
  t.true(state.from <= new Date(Date.now() - 29 * HOUR))
})

// Regression: refresh used to build only the last two hours while claiming the whole
// range as covered. After the worker was down, reports would read missing buckets as zero
// instead of building them.
test('refresh fills the gap left by downtime', async (t) => {
  const domainId = uuid()
  await seed(domainId, 30)

  const now = floorHour(new Date())
  const stale = new Date(now.getTime() - 6 * HOUR)

  // A state as if the worker stopped six hours ago and only got as far as `stale`.
  await backfill(domainId)
  await Rollup.deleteMany({ domainId, bucket: { $gte: stale } })
  await RollupState.updateOne({ domainId }, { $set: { to: stale } })

  await refresh(domainId)

  const state = await RollupState.findOne({ domainId }).lean()
  const rebuilt = await Rollup.countDocuments({ domainId, bucket: { $gte: stale, $lt: now } })

  t.is(state.to.getTime(), now.getTime())
  t.true(rebuilt > 0, 'buckets inside the gap should have been built')
})

test.serial('refreshAll walks every domain and survives a broken one', async (t) => {
  const domain = await Domain.create({ title: 'Example', workspaceId: uuid() })
  await seed(domain.id, 5)

  // A domain with no records at all: refresh has to handle it without throwing.
  await Domain.create({ title: 'Empty', workspaceId: uuid() })

  await refreshAll()

  const state = await RollupState.findOne({ domainId: domain.id }).lean()

  t.not(state, null)
  t.is(state.to.getTime(), floorHour(new Date()).getTime())
})

test.serial('the scheduler starts only while the flag is on', (t) => {
  delete process.env.ACKEE_ROLLUPS
  t.is(start(), null)

  process.env.ACKEE_ROLLUPS = 'true'
  const job = start()

  t.not(job, null)
  job.cancel()

  delete process.env.ACKEE_ROLLUPS
})
