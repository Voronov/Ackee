// What the raw part of A costs on a live site. On the stand the data ends before today,
// so the part A reads from raw records is empty. On a live site it is the running day for
// unique views (see uniqueViews in src/rollups/read.js) and the running hour for the rest.
// This times those aggregations over one full day and one full hour of the stand's data.
//
//   docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/tail-cost.js [--day 2026-10-16] [--runs 3]
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'

import aggregateDurations from '../../src/aggregations/aggregateDurations.js'
import aggregateViews from '../../src/aggregations/aggregateViews.js'
import { INTERVALS_DAILY } from '../../src/constants/intervals.js'
import Record from '../../src/models/Record.js'
import { connectStand, disconnectStand, markdownTable, median, requireUtc, resolveDomainId } from './stand.js'

const DAY = 86_400_000
const HOUR = 3_600_000

const { values } = parseArgs({
  options: {
    day: { type: 'string' },
    runs: { type: 'string', default: '3' },
    domain: { type: 'string' },
  },
})

requireUtc()
await connectStand()

const ids = [await resolveDomainId(values.domain)]

// The last full day with data, unless given
const newest = await Record.findOne({ domainId: ids[0] }).sort({ created: -1 }).select('created').lean()
const from =
  values.day == null ? new Date(Math.floor(newest.created.getTime() / DAY) * DAY - DAY) : new Date(values.day)

// The report aggregations with their lower bound moved to `from` and an upper bound added
const bounded = (aggregation, to) => {
  aggregation[0].$match.created = { $gte: from, $lt: to }
  return aggregation
}

const dateDetails = { userTimeZone: 'UTC', includeFnByInterval: () => () => from }

const cases = [
  ['unique views, one day', () => aggregateViews(ids, true, INTERVALS_DAILY, 1, dateDetails), DAY],
  ['unique views, one hour', () => aggregateViews(ids, true, INTERVALS_DAILY, 1, dateDetails), HOUR],
  ['durations, one hour', () => aggregateDurations(ids, INTERVALS_DAILY, 1, dateDetails), HOUR],
]

const rows = []

for (const [name, build, length] of cases) {
  const to = new Date(from.getTime() + length)
  const timings = []
  let count

  for (let index = 0; index < Number(values.runs); index++) {
    const started = performance.now()
    const [result] = await Record.aggregate(bounded(build(), to))
    timings.push(performance.now() - started)
    count = result?.count
  }

  const records = await Record.countDocuments({ domainId: ids[0], created: { $gte: from, $lt: to } })
  rows.push([name, from.toISOString(), records, Math.round(median(timings)), Math.round(Math.max(...timings)), count])
}

process.stdout.write(markdownTable(['Raw part', 'From', 'Records', 'Median, ms', 'Max, ms', 'Result'], rows))

await disconnectStand()
