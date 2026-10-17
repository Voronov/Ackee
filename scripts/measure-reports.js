import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'

import signale from '../src/utils/signale.js'
import { minute } from '../src/utils/times.js'

// The dashboard queries of the 30 day reports, without the UI around them.
// The dashboard asks for 14 days of durations, 30 match the other reports.
export const reports = [
  {
    key: 'views-unique',
    name: 'views DAILY UNIQUE',
    field: 'views(interval: DAILY, type: UNIQUE, limit: 30) { id count }',
    describe: (data) => `${sum(data.views)} views`,
  },
  {
    key: 'views-total',
    name: 'views DAILY TOTAL',
    field: 'views(interval: DAILY, type: TOTAL, limit: 30) { id count }',
    describe: (data) => `${sum(data.views)} views`,
  },
  {
    key: 'referrers',
    name: 'referrers TOP LAST_30_DAYS',
    field: 'referrers(sorting: TOP, type: WITH_SOURCE, range: LAST_30_DAYS) { id value count }',
    describe: (data) => `${data.referrers.length} referrers`,
  },
  {
    key: 'durations',
    name: 'durations DAILY',
    field: 'durations(interval: DAILY, limit: 30) { id count }',
    describe: (data) => `${Math.round(averageOfDays(data.durations) / 1000)} s average`,
  },
]

export const defaults = {
  url: 'http://127.0.0.1:3100',
  username: 'bench',
  password: 'bench',
  runs: 3,
  timeout: 60,
  timeZone: 'UTC',
}

const sum = (entries) => entries.reduce((total, entry) => total + entry.count, 0)

// Days without records report 0, which is no duration at all
const averageOfDays = (entries) => {
  const days = entries.filter((entry) => entry.count > 0)
  return days.length === 0 ? 0 : sum(days) / days.length
}

export const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export const parseOptions = (args) => {
  const { values } = parseArgs({
    args,
    options: {
      'url': { type: 'string', default: defaults.url },
      'username': { type: 'string', default: defaults.username },
      'password': { type: 'string', default: defaults.password },
      'domain': { type: 'string' },
      'report': { type: 'string', multiple: true },
      'runs': { type: 'string', default: String(defaults.runs) },
      'timeout': { type: 'string', default: String(defaults.timeout) },
      'time-zone': { type: 'string', default: defaults.timeZone },
    },
  })

  const toInteger = (name) => {
    const value = values[name]
    if (/^\d+$/.test(value) === false || Number(value) < 1) {
      throw new Error(`Option --${name} must be a positive integer`)
    }
    return Number(value)
  }

  const keys = values.report ?? reports.map((report) => report.key)
  const unknown = keys.find((key) => reports.some((report) => report.key === key) === false)
  if (unknown != null) {
    throw new Error(`Unknown report ${unknown}, use one of: ${reports.map((report) => report.key).join(', ')}`)
  }

  return {
    url: values.url,
    username: values.username,
    password: values.password,
    domainId: values.domain,
    reports: reports.filter((report) => keys.includes(report.key)),
    runs: toInteger('runs'),
    timeout: toInteger('timeout') * minute,
    timeZone: values['time-zone'],
  }
}

class TimeoutError extends Error {}

// Plain node:http instead of fetch: undici gives up on a response after 300 s
// of silence, and a slow report is exactly what has to be measured
export const post = (url, body, { token, timeZone, timeout }) =>
  new Promise((resolve, reject) => {
    const target = new URL('/api', url)
    const client = target.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body)

    const request = client.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token == null ? {} : { Authorization: `Bearer ${token}` }),
          ...(timeZone == null ? {} : { 'Time-Zone': timeZone }),
        },
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (text += chunk))
        response.on('error', reject)
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 200)}`))
            return
          }
          // Thrown inside the event handler it would escape the promise and kill the run
          try {
            resolve(JSON.parse(text))
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.setTimeout(timeout, () => request.destroy(new TimeoutError(`No response within ${timeout / 1000} s`)))
    request.on('error', reject)
    request.end(payload)
  })

const query = async (options, body) => {
  const json = await post(options.url, body, options)
  if (json.errors != null) throw new Error(json.errors.map((error) => error.message).join('; '))
  return json.data
}

const login = async (options) => {
  const data = await query(options, {
    query: 'mutation createToken($input: CreateTokenInput!) { createToken(input: $input) { payload { id } } }',
    variables: { input: { username: options.username, password: options.password } },
  })
  return data.createToken.payload.id
}

const logout = (options) =>
  query(options, {
    query: 'mutation deleteToken($id: ID!) { deleteToken(id: $id) { success } }',
    variables: { id: options.token },
  })

const resolveDomainId = async (options) => {
  if (options.domainId != null) return options.domainId

  const { domains } = await query(options, { query: '{ domains { id title } }' })
  if (domains.length === 1) return domains[0].id

  const list = domains.map((domain) => `${domain.id} (${domain.title})`).join(', ')
  throw new Error(`Pass --domain, the stand has ${domains.length} domains: ${list || 'none'}`)
}

export const measureReport = async (options, report) => {
  const body = {
    query: `query measure($id: ID!) { domain(id: $id) { statistics { ${report.field} } } }`,
    variables: { id: options.domainId },
  }

  const started = performance.now()
  try {
    const data = await query(options, body)
    const seconds = (performance.now() - started) / 1000
    if (data.domain == null) throw new Error(`Domain ${options.domainId} not found`)
    return { seconds, result: report.describe(data.domain.statistics) }
  } catch (error) {
    return {
      seconds: (performance.now() - started) / 1000,
      error: error.message,
      timedOut: error instanceof TimeoutError,
    }
  }
}

export const summarizeRuns = (runs) => {
  const passed = runs.filter((run) => run.error == null).map((run) => run.seconds)

  return {
    runs: runs.length,
    failed: runs.length - passed.length,
    median: passed.length === 0 ? undefined : median(passed),
    min: passed.length === 0 ? undefined : Math.min(...passed),
    max: passed.length === 0 ? undefined : Math.max(...passed),
    result: runs.find((run) => run.error == null)?.result ?? runs.at(-1)?.error,
  }
}

const seconds = (value) => (value == null ? '–' : value.toFixed(1))

// Markdown, so the output goes straight into docs/engineering/benchmark-stand.md
export const formatTable = (rows) => {
  const lines = [
    '| Report | Runs | Failed | Median, s | Min, s | Max, s | Result |',
    '| ------ | ---- | ------ | --------- | ------ | ------ | ------ |',
    ...rows.map(
      ({ name, summary }) =>
        `| ${name} | ${summary.runs} | ${summary.failed} | ${seconds(summary.median)} | ${seconds(summary.min)} | ${seconds(summary.max)} | ${summary.result} |`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

export const run = async (options) => {
  const token = await login(options)
  const authorized = { ...options, token }

  try {
    const domainId = await resolveDomainId(authorized)
    signale.info(`Measuring domain ${domainId} on ${options.url}, ${options.runs} runs per report`)

    const rows = []
    for (const report of options.reports) {
      const runs = []
      for (let index = 0; index < options.runs; index++) {
        const result = await measureReport({ ...authorized, domainId }, report)
        runs.push(result)

        const label = `${report.name} #${index + 1}: ${seconds(result.seconds)} s`
        if (result.error == null) signale.success(`${label}, ${result.result}`)
        else signale.error(`${label}, ${result.error}`)

        // The server keeps aggregating after the client gave up, so every later
        // run would compete with that query and measure nothing useful
        if (result.timedOut === true) {
          rows.push({ name: report.name, summary: summarizeRuns(runs) })
          signale.warn('Stopped after a timeout: restart the stand before measuring again')
          return rows
        }
      }
      rows.push({ name: report.name, summary: summarizeRuns(runs) })
    }

    return rows
  } finally {
    // A leftover token is harmless, losing the measured numbers is not
    await logout(authorized).catch((error) => signale.warn(`Could not delete the token: ${error.message}`))
  }
}

const main = async () => {
  const options = parseOptions(process.argv.slice(2))
  const rows = await run(options)
  process.stdout.write(formatTable(rows))
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename

if (isMain === true) {
  main().catch((error) => {
    signale.fatal(error)
    process.exit(1)
  })
}
