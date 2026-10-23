import test from 'ava'
import mockedEnv from 'mocked-env'
import http from 'node:http'
import listen from 'test-listen'

import {
  defaults,
  formatTable,
  measureReport,
  median,
  parseOptions,
  post,
  reports,
  run,
  summarizeRuns,
} from '../../scripts/measure-reports.js'
import Domain from '../../src/models/Domain.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { minute } from '../../src/utils/times.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from '../resolvers/_utils.js'

const base = listen(server)

const credentials = { username: 'bench', password: 'secret' }

const options = async (overrides) => ({
  url: await base,
  ...credentials,
  reports,
  runs: 2,
  timeout: minute,
  timeZone: 'UTC',
  ...overrides,
})

// A server that answers every request the given way, for client failures the real API never produces
const fakeApi = async (handler) => {
  const fake = http.createServer(handler)
  const url = await listen(fake)
  return {
    url,
    close: () => {
      fake.closeAllConnections()
      fake.close()
    },
  }
}

let restoreEnv

test.before(async () => {
  restoreEnv = mockedEnv({ ACKEE_USERNAME: credentials.username, ACKEE_PASSWORD: credentials.password })
  await connectToDatabase()
})

test.after.always(async () => {
  restoreEnv()
  await cleanup(server)()
})

test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test('calculates the median', (t) => {
  t.is(median([3]), 3)
  t.is(median([5, 1, 3]), 3)
  t.is(median([4, 1, 3, 2]), 2.5)
})

test('parses options with defaults', (t) => {
  const parsed = parseOptions([])

  t.is(parsed.url, defaults.url)
  t.is(parsed.username, defaults.username)
  t.is(parsed.password, defaults.password)
  t.is(parsed.domainId, undefined)
  t.deepEqual(parsed.reports, reports)
  t.is(parsed.runs, 3)
  t.is(parsed.timeout, 60 * minute)
  t.is(parsed.timeZone, 'UTC')
  t.is(parsed.unit, 's')
})

test('parses options from arguments', (t) => {
  const parsed = parseOptions([
    '--url',
    'http://localhost:4000',
    '--username',
    'user',
    '--password',
    'pass',
    '--domain',
    'domain',
    '--report',
    'referrers',
    '--report',
    'views-unique',
    '--report',
    'durations',
    '--runs',
    '5',
    '--timeout',
    '30',
    '--time-zone',
    'Europe/Kyiv',
    '--unit',
    'ms',
  ])

  t.is(parsed.url, 'http://localhost:4000')
  t.is(parsed.username, 'user')
  t.is(parsed.password, 'pass')
  t.is(parsed.domainId, 'domain')
  t.deepEqual(
    parsed.reports.map((report) => report.key),
    ['views-unique', 'referrers', 'durations'],
  )
  t.is(parsed.runs, 5)
  t.is(parsed.timeout, 30 * minute)
  t.is(parsed.timeZone, 'Europe/Kyiv')
  t.is(parsed.unit, 'ms')
})

test('rejects invalid options', (t) => {
  t.throws(() => parseOptions(['--runs', '0']), { message: 'Option --runs must be a positive integer' })
  t.throws(() => parseOptions(['--timeout', '1.5']), { message: 'Option --timeout must be a positive integer' })
  t.throws(() => parseOptions(['--unit', 'min']), { message: 'Unknown unit min, use one of: s, ms' })
  t.throws(() => parseOptions(['--report', 'pages']), {
    message: 'Unknown report pages, use one of: views-unique, views-total, referrers, durations',
  })
})

test('summarizes runs without the failed ones', (t) => {
  const summary = summarizeRuns([
    { seconds: 3, result: '10 views' },
    { seconds: 300, error: 'socket hang up' },
    { seconds: 1, result: '10 views' },
    { seconds: 2, result: '10 views' },
  ])

  t.deepEqual(summary, { runs: 4, failed: 1, median: 2, min: 1, max: 3, result: '10 views' })
})

test('summarizes runs that all failed', (t) => {
  const summary = summarizeRuns([{ seconds: 300, error: 'socket hang up' }])

  t.deepEqual(summary, {
    runs: 1,
    failed: 1,
    median: undefined,
    min: undefined,
    max: undefined,
    result: 'socket hang up',
  })
})

test('formats the summary as a markdown table', (t) => {
  const table = formatTable([
    { name: 'views', summary: { runs: 3, failed: 0, median: 187.94, min: 180, max: 190.06, result: '5 views' } },
    { name: 'referrers', summary: { runs: 1, failed: 1, result: 'socket hang up' } },
  ])

  t.is(
    table,
    [
      '| Report | Runs | Failed | Median, s | Min, s | Max, s | Result |',
      '| ------ | ---- | ------ | --------- | ------ | ------ | ------ |',
      '| views | 3 | 0 | 187.9 | 180.0 | 190.1 | 5 views |',
      '| referrers | 1 | 1 | – | – | – | socket hang up |',
      '',
    ].join('\n'),
  )
})

// Rollups and ClickHouse answer below the 0.1 s a table in seconds can show
test('formats the summary in milliseconds', (t) => {
  const table = formatTable(
    [{ name: 'views', summary: { runs: 3, failed: 0, median: 0.0194, min: 0.0126, max: 0.31, result: '5 views' } }],
    'ms',
  )

  t.is(
    table,
    [
      '| Report | Runs | Failed | Median, ms | Min, ms | Max, ms | Result |',
      '| ------ | ---- | ------ | ---------- | ------- | ------- | ------ |',
      '| views | 3 | 0 | 19 | 13 | 310 | 5 views |',
      '',
    ].join('\n'),
  )
})

test.serial('measures every report of the only domain', async (t) => {
  const rows = await run(await options())

  t.deepEqual(
    rows.map((row) => row.name),
    reports.map((report) => report.name),
  )
  t.true(rows.every((row) => row.summary.runs === 2 && row.summary.failed === 0))
  t.true(rows.every((row) => row.summary.median >= 0 && row.summary.min <= row.summary.max))
  t.deepEqual(
    rows.map((row) => row.summary.result),
    ['14 views', '14 views', '2 referrers', '60 s average'],
  )
})

test.serial('deletes its token after measuring', async (t) => {
  const before = await Token.countDocuments()

  await run(await options({ runs: 1 }))

  t.is(await Token.countDocuments(), before)
})

test.serial('measures the given domain', async (t) => {
  const other = await Domain.create({ title: 'Other' })
  t.teardown(() => Domain.deleteOne({ id: other.id }))

  const rows = await run(await options({ runs: 1, domainId: other.id }))

  t.deepEqual(
    rows.map((row) => row.summary.result),
    ['0 views', '0 views', '0 referrers', '0 s average'],
  )
})

test.serial('asks for a domain when the stand has several', async (t) => {
  const other = await Domain.create({ title: 'Other' })
  t.teardown(() => Domain.deleteOne({ id: other.id }))

  await t.throwsAsync(run(await options()), { message: /^Pass --domain, the stand has 2 domains: / })
})

test.serial('fails with wrong credentials', async (t) => {
  await t.throwsAsync(run(await options({ password: 'wrong' })), { message: 'Username or password incorrect' })
})

test.serial('records a missing domain as a failed run', async (t) => {
  const token = await Token.create({})
  t.teardown(() => Token.deleteOne({ id: token.id }))

  const result = await measureReport(await options({ token: token.id, domainId: 'missing' }), reports[0])

  t.is(result.error, 'Domain missing not found')
  t.true(result.seconds >= 0)
})

test('stops measuring after a timeout', async (t) => {
  // Answers everything but the reports, like a server stuck in a long aggregation
  const fake = await fakeApi(async (request, response) => {
    const body = JSON.parse(await request.toArray().then((chunks) => Buffer.concat(chunks).toString()))
    if (body.query.startsWith('query measure')) return

    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        data: {
          createToken: { payload: { id: 'token' } },
          domains: [{ id: 'domain', title: 'Domain' }],
          deleteToken: { success: true },
        },
      }),
    )
  })
  t.teardown(fake.close)

  const rows = await run({ url: fake.url, reports, runs: 3, timeout: 100 })

  t.is(rows.length, 1)
  t.is(rows[0].name, reports[0].name)
  t.like(rows[0].summary, { runs: 1, failed: 1, result: 'No response within 0.1 s' })
})

test('gives up on a response after the timeout', async (t) => {
  const fake = await fakeApi(() => {})
  t.teardown(fake.close)

  await t.throwsAsync(post(fake.url, {}, { timeout: 100 }), { message: 'No response within 0.1 s' })
})

test('records a response that is not JSON as a failed run', async (t) => {
  const fake = await fakeApi((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<html>Maintenance</html>')
  })
  t.teardown(fake.close)

  const result = await measureReport({ url: fake.url, domainId: 'domain', timeout: minute }, reports[0])

  t.regex(result.error, /JSON/)
  t.false(result.timedOut)
  t.like(summarizeRuns([result]), { runs: 1, failed: 1 })
})

test('fails on an unexpected status code', async (t) => {
  const fake = await fakeApi((request, response) => {
    response.statusCode = 502
    response.end('Bad gateway')
  })
  t.teardown(fake.close)

  await t.throwsAsync(post(fake.url, {}, { timeout: minute }), { message: 'HTTP 502: Bad gateway' })
})
