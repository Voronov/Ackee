// Parity of the four reports across the variants of ACKEE-15, at the data layer and from
// one fixed "now": raw MongoDB records (the v1.0 path), A (rollups), B (ClickHouse store)
// and C (materialized views, variantC.js). Exits with 1 on any difference.
//
//   TZ=UTC ACKEE_MONGODB=… ACKEE_CLICKHOUSE=… ACKEE_CLICKHOUSE_PASSWORD=… \
//     node tools/spike-15/parity.js [--now ISO] [--time-zone UTC --time-zone Europe/Kiev] [--variant a …]
//
// Variant A needs rollups that cover the window up to the current hour, which the worker
// of a running Ackee with ACKEE_ROLLUPS=true keeps up to date.
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'

import createDate from '../../src/utils/createDate.js'
import signale from '../../src/utils/signale.js'
import { compare, describeDifferences } from './compare.js'
import { reportKeys, reports } from './reports.js'
import { connectStand, disconnectStand, markdownTable, requireUtc, resolveDomainId } from './stand.js'

const variants = ['a', 'b', 'c']

const { values } = parseArgs({
  options: {
    'now': { type: 'string' },
    'time-zone': { type: 'string', multiple: true, default: ['UTC', 'Europe/Kiev'] },
    'variant': { type: 'string', multiple: true, default: variants },
    'report': { type: 'string', multiple: true, default: reportKeys },
    'domain': { type: 'string' },
  },
})

requireUtc()

const now = values.now == null ? new Date() : new Date(values.now)
if (Number.isNaN(now.getTime())) throw new Error('Option --now must be a valid date')

await connectStand()
const ids = [await resolveDomainId(values.domain)]

signale.info(`Domain ${ids[0]}, now ${now.toISOString()}`)

const timed = async (fn) => {
  const started = performance.now()
  try {
    return { entries: await fn(), seconds: (performance.now() - started) / 1000 }
  } catch (error) {
    return { error: error.message }
  }
}

const rows = []
let failed = false

for (const timeZone of values['time-zone']) {
  for (const key of values.report) {
    const report = reports[key]
    const dateDetails = createDate(timeZone, now)

    const raw = await timed(() => report.raw(ids, dateDetails))
    if (raw.error != null) throw new Error(`${report.name}, raw: ${raw.error}`)

    const cells = []

    for (const variant of variants) {
      if (values.variant.includes(variant) === false) {
        cells.push('–')
        continue
      }

      const result = await timed(() => report[variant](ids, dateDetails))

      if (result.error != null) {
        failed = true
        cells.push(`ERROR: ${result.error}`)
        continue
      }

      const found = compare(report.kind, raw.entries, result.entries)
      if (found.length > 0) failed = true

      cells.push(`${describeDifferences(found)} (${result.seconds.toFixed(2)} s)`)
    }

    signale.info(`${report.name}, ${timeZone}: ${report.describe(raw.entries)}, ${cells.join(', ')}`)
    rows.push([report.name, timeZone, `${report.describe(raw.entries)} (${raw.seconds.toFixed(1)} s)`, ...cells])
  }
}

process.stdout.write(markdownTable(['Report', 'Time zone', 'Raw MongoDB (v1.0 path)', 'A', 'B', 'C'], rows))

await disconnectStand()

if (failed === true) process.exit(1)
