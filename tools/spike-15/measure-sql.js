// Single-request timings of the SQL behind variants B and C of ACKEE-15, without Ackee
// and GraphQL around it. The queries are the ones the ClickHouse store (B) and
// variantC.js (C) send, captured rather than copied, so B here is exactly B in Ackee.
//
//   TZ=UTC ACKEE_CLICKHOUSE=… ACKEE_CLICKHOUSE_PASSWORD=… node tools/spike-15/measure-sql.js \
//     [--variant b --variant c] [--report views-unique …] [--runs 3] [--time-zone Europe/Kiev] [--k6 dir]
//
// `--k6 dir` also writes every query as `<variant>-<report>.json` for k6-sql.js.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'

import { getClient } from '../../src/clickhouse/client.js'
import config from '../../src/utils/config.js'
import createDate from '../../src/utils/createDate.js'
import signale from '../../src/utils/signale.js'
import { reportKeys, reports } from './reports.js'
import { disconnectStand, markdownTable, median, requireUtc } from './stand.js'

const { values } = parseArgs({
  options: {
    'variant': { type: 'string', multiple: true, default: ['b', 'c'] },
    'report': { type: 'string', multiple: true, default: reportKeys },
    'runs': { type: 'string', default: '3' },
    // The dashboard's zone of the stand's users, as in the measurements of ACKEE-15
    'time-zone': { type: 'string', default: 'Europe/Kiev' },
    'domain': { type: 'string' },
    'k6': { type: 'string' },
  },
})

requireUtc()

if (config.clickhouseUrl == null) throw new Error('ACKEE_CLICKHOUSE is missing')

const runs = Number(values.runs)
const client = getClient()

const resolveDomainId = async () => {
  if (values.domain != null) return values.domain

  const result = await client.query({
    query: 'SELECT DISTINCT domainId FROM {database:Identifier}.records LIMIT 2',
    query_params: { database: config.clickhouseDatabase },
    format: 'JSONEachRow',
  })
  const domains = await result.json()
  if (domains.length === 1) return domains[0].domainId

  throw new Error(`Pass --domain, ClickHouse holds ${domains.length === 2 ? 'several' : 'no'} domains`)
}

// Runs a report once with a client that only records its queries. Nothing reaches the
// server, so the first timed run below stays the first one the server sees.
const capture = async (fn) => {
  const calls = []
  client.query = (parameters) => {
    calls.push(parameters)
    return Promise.resolve({ json: () => Promise.resolve([]) })
  }

  try {
    await fn()
  } finally {
    delete client.query
  }

  return calls
}

const execute = async (calls) => {
  const started = performance.now()
  for (const call of calls) await (await client.query(call)).json()
  return (performance.now() - started) / 1000
}

// The same text the client puts into the URL, see @clickhouse/client formatQueryParams
const formatParameter = (value) => {
  if (value instanceof Date) {
    return `${Math.floor(value.getTime() / 1000)}.${String(value.getUTCMilliseconds()).padStart(3, '0')}`
  }
  if (Array.isArray(value)) return `[${value.map((entry) => `'${entry}'`).join(',')}]`
  return String(value)
}

const writeK6 = async (name, calls) => {
  if (calls.length !== 1) throw new Error(`${name}: k6 replays one query, the report sends ${calls.length}`)

  const [call] = calls
  const plan = {
    query: call.query,
    params: Object.fromEntries(Object.entries(call.query_params).map(([key, value]) => [key, formatParameter(value)])),
    settings: { ...call.clickhouse_settings, default_format: call.format },
  }

  await mkdir(values.k6, { recursive: true })
  await writeFile(path.join(values.k6, `${name}.json`), `${JSON.stringify(plan, null, 2)}\n`)
}

const ids = [await resolveDomainId()]
const dateDetails = createDate(values['time-zone'])
const seconds = (value) => (value == null ? '–' : (value * 1000).toFixed(0))
const rows = []

signale.info(`Domain ${ids[0]} on ${config.clickhouseUrl}, ${runs} runs per report, ${values['time-zone']}`)

for (const variant of values.variant) {
  for (const key of values.report) {
    const report = reports[key]
    const calls = await capture(() => report[variant](ids, dateDetails))

    if (values.k6 != null) await writeK6(`${variant}-${key}`, calls)

    const timings = []
    let error

    for (let index = 0; index < runs; index++) {
      try {
        const time = await execute(calls)
        timings.push(time)
        signale.success(`${variant.toUpperCase()} ${report.name} #${index + 1}: ${seconds(time)} ms`)
      } catch (error_) {
        error = error_.message
        signale.error(`${variant.toUpperCase()} ${report.name} #${index + 1}: ${error}`)
      }
    }

    // Once more through the real code path, for the numbers and as a sanity check
    const result = error ?? report.describe(await report[variant](ids, dateDetails))

    rows.push([
      variant.toUpperCase(),
      report.name,
      runs,
      runs - timings.length,
      seconds(timings.length === 0 ? undefined : median(timings)),
      seconds(timings.length === 0 ? undefined : Math.min(...timings)),
      seconds(timings.length === 0 ? undefined : Math.max(...timings)),
      result,
    ])
  }
}

process.stdout.write(
  markdownTable(['Variant', 'Report', 'Runs', 'Failed', 'Median, ms', 'Min, ms', 'Max, ms', 'Result'], rows),
)

await disconnectStand()
