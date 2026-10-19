// End-to-end parity through GraphQL: v1.0 (develop, the stand's own Ackee) against the
// Ackee of this branch in variant A and B. All targets get the same request at the same
// moment, so the sliding 30-day window of referrers starts at the same millisecond within
// the request latency. Exits with 1 on any difference.
//
//   TZ=UTC ACKEE_MONGODB=mongodb://127.0.0.1:27018/ackee node tools/spike-15/parity-api.js --domain <id> \
//     [--time-zone UTC --time-zone Europe/Kiev]
//
// A target is `name=url,username,password`; the defaults are the stand's three servers.
// The target named by `--rollups` (A by default, `--rollups none` to skip) is checked for
// rollups that cover the window first, which needs TZ=UTC and ACKEE_MONGODB of the stand.
import { parseArgs } from 'node:util'

import signale from '../../src/utils/signale.js'
import { login, logout, query } from './api.js'
import { compare, describeDifferences } from './compare.js'
import { requireRollups } from './rollups-ready.js'
import { markdownTable } from './stand.js'

const reports = [
  { name: 'views DAILY UNIQUE', kind: 'interval', field: 'views(interval: DAILY, type: UNIQUE, limit: 30)' },
  { name: 'views DAILY TOTAL', kind: 'interval', field: 'views(interval: DAILY, type: TOTAL, limit: 30)' },
  {
    name: 'referrers TOP LAST_30_DAYS',
    kind: 'top',
    field: 'referrers(sorting: TOP, type: WITH_SOURCE, range: LAST_30_DAYS)',
  },
  { name: 'durations DAILY', kind: 'interval', field: 'durations(interval: DAILY, limit: 30)' },
]

const { values } = parseArgs({
  options: {
    'domain': { type: 'string' },
    'rollups': { type: 'string', default: 'A' },
    'time-zone': { type: 'string', multiple: true, default: ['UTC', 'Europe/Kiev'] },
    'target': {
      type: 'string',
      multiple: true,
      default: [
        'v1.0=http://127.0.0.1:3100,bench,bench',
        'A=http://127.0.0.1:3200,bench@bench.local,bench',
        'B=http://127.0.0.1:3300,bench@bench.local,bench',
      ],
    },
  },
})

if (values.domain == null) throw new Error('Pass --domain')

const targets = values.target.map((entry) => {
  const [name, rest] = entry.split('=')
  const [url, username, password] = rest.split(',')
  return { name, url, username, password }
})

// Otherwise a lagging A answers from raw records and the comparison is v1.0 against v1.0
if (targets.some((target) => target.name === values.rollups)) await requireRollups(values.domain)

for (const target of targets) {
  target.token = await login(target.url, target.username, target.password)
}

const fetchReport = (target, report, timeZone) =>
  query(
    target.url,
    {
      query: `query parity($id: ID!) { domain(id: $id) { statistics { result: ${report.field} { id value count } } } }`,
      variables: { id: values.domain },
    },
    { token: target.token, timeZone },
  ).then((data) => data.domain.statistics.result)

const rows = []
let failed = false

try {
  for (const timeZone of values['time-zone']) {
    for (const report of reports) {
      const results = await Promise.all(targets.map((target) => fetchReport(target, report, timeZone)))
      const [expected, ...others] = results

      const cells = others.map((entries) => {
        const found = compare(report.kind, expected, entries)
        if (found.length > 0) failed = true
        return describeDifferences(found)
      })

      const total = expected.reduce((sum, entry) => sum + entry.count, 0)
      signale.info(`${report.name}, ${timeZone}: ${cells.join(', ')}`)
      rows.push([report.name, timeZone, `${expected.length} entries, sum ${total}`, ...cells])
    }
  }
} finally {
  await Promise.all(targets.map((target) => logout(target.url, target.token).catch(() => {})))
}

process.stdout.write(
  markdownTable(['Report', 'Time zone', targets[0].name, ...targets.slice(1).map((target) => target.name)], rows),
)

if (failed === true) process.exit(1)
