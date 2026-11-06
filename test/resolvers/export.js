import test from 'ava'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import { toCsv } from '../../src/export.js'
import AuditLog from '../../src/models/AuditLog.js'
import Domain from '../../src/models/Domain.js'
import Ga4Daily from '../../src/models/Ga4Daily.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import signale from '../../src/utils/signale.js'
import { DEFAULT_WORKSPACE_ID } from '../../src/constants/workspaces.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
// A domain of its own, next to the records fillDatabase makes
test.beforeEach(async (t) => {
  await fillDatabase(t)
  t.context.domain = await Domain.create({ title: 'Export', workspaceId: DEFAULT_WORKSPACE_ID })
})
test.afterEach.always(cleanupDatabase)

const get = async (path, token) => {
  const response = await fetch(new URL(path, await base), {
    headers: token == null ? {} : { Authorization: `Bearer ${token}` },
  })
  return { status: response.status, headers: response.headers, body: await response.arrayBuffer() }
}

const text = (body) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(body)

// The audit entry is written after the answer has left, so a test may get there first
const audited = async (filter, expected) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await AuditLog.countDocuments(filter)) >= expected) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

// A source in Cyrillic and a referrer that would run as a formula in Excel
const seed = (domainId) =>
  Record.insertMany(
    ['Розсилка', 'Розсилка', '=HYPERLINK("https://evil.example","click")'].map((source) => ({
      domainId,
      siteLocation: 'https://example.com/',
      source,
      created: new Date(),
      updated: new Date(),
    })),
  )

test.serial('a report comes as CSV that Excel opens with Cyrillic', async (t) => {
  await seed(t.context.domain.id)

  const { status, headers, body } = await get(
    `/export/referrers.csv?domainId=${t.context.domain.id}&type=ONLY_SOURCE&range=LAST_7_DAYS`,
    t.context.token.id,
  )

  t.is(status, 200)
  t.is(headers.get('content-type'), 'text/csv; charset=utf-8')
  t.regex(headers.get('content-disposition'), /^attachment; filename="ackee-referrers-\d{4}-\d{2}-\d{2}\.csv"$/)
  t.is(headers.get('cache-control'), 'no-store')

  // The byte order mark tells Excel the file is UTF-8
  t.deepEqual([...new Uint8Array(body.slice(0, 3))], [239, 187, 191])

  const lines = text(body).slice(1).split('\r\n')
  t.is(lines[0], 'value,count,created')
  t.true(lines[1].startsWith('Розсилка,2,'))
  // A formula is plain text in the sheet, not something it runs
  t.true(lines[2].startsWith(`"'=HYPERLINK(""https://evil.example"",""click"")",1,`))
})

test.serial('a report comes as JSON, and the views chart with its days', async (t) => {
  await seed(t.context.domain.id)

  const list = await get(`/export/referrers.json?domainId=${t.context.domain.id}&type=ONLY_SOURCE`, t.context.token.id)
  t.is(list.status, 200)
  const entries = JSON.parse(text(list.body))
  t.deepEqual(
    entries.map((entry) => [entry.value, entry.count]),
    [
      ['Розсилка', 2],
      ['=HYPERLINK("https://evil.example","click")', 1],
    ],
  )

  const views = await get(`/export/views.csv?domainId=${t.context.domain.id}&limit=3`, t.context.token.id)
  const lines = text(views.body).slice(1).trim().split('\r\n')
  t.is(lines[0], 'value,count')
  t.is(lines.length, 4)
})

test.serial('a semicolon is there for an Excel that splits by it', async (t) => {
  await seed(t.context.domain.id)

  const { body } = await get(
    `/export/referrers.csv?domainId=${t.context.domain.id}&type=ONLY_SOURCE&delimiter=semicolon`,
    t.context.token.id,
  )

  t.is(text(body).slice(1).split('\r\n')[0], 'value;count;created')
})

test.serial('an export needs a token', async (t) => {
  t.is((await get(`/export/referrers.csv?domainId=${t.context.domain.id}`)).status, 401)
  t.is((await get(`/export/referrers.csv?domainId=${t.context.domain.id}`, 'not-a-token')).status, 401)
})

test.serial('a permanent token exports as well', async (t) => {
  await seed(t.context.domain.id)

  const { status } = await get(`/export/pages.json?domainId=${t.context.domain.id}`, t.context.permanentToken.id)

  t.is(status, 200)
})

test.serial('an unknown report or format is 404', async (t) => {
  for (const path of ['/export/secrets.csv', '/export/referrers.xlsx', '/export/referrers', '/export/__proto__.json']) {
    t.is((await get(path, t.context.token.id)).status, 404, path)
  }
})

test.serial('a domain of another workspace is 404, the same as a domain that does not exist', async (t) => {
  await seed(t.context.domain.id)
  const { user, workspace } = await users.add({ email: 'mallory-export@example.com', password: 'sufficiently-long' })
  const token = await Token.create({ userId: user.id })
  const own = await Domain.create({ title: 'Mallory', workspaceId: workspace.id })

  const foreign = await get(`/export/referrers.csv?domainId=${t.context.domain.id}&type=ONLY_SOURCE`, token.id)
  const missing = await get('/export/referrers.csv?domainId=00000000-0000-4000-8000-000000000000', token.id)
  t.is(foreign.status, 404)
  t.is(missing.status, 404)
  t.is(text(foreign.body), text(missing.body))

  // Without a domain the export holds only the viewer's own domains
  const all = await get('/export/referrers.json?type=ONLY_SOURCE', token.id)
  t.deepEqual(JSON.parse(text(all.body)), [])
  t.truthy(own)

  // The attempt leaves a trace in the viewer's workspace, not in the one that owns the domain
  t.true(await audited({ workspaceId: workspace.id, action: 'export.referrers', details: /^error/ }, 1))
  t.is(await AuditLog.countDocuments({ workspaceId: t.context.workspace.id, userId: user.id }), 0)
})

test.serial('a wrong argument is 400', async (t) => {
  const { status, body } = await get(`/export/referrers.csv?range=FOREVER`, t.context.token.id)

  t.is(status, 400)
  t.regex(JSON.parse(text(body)).error, /FOREVER/)
})

test.serial('a report of Google Analytics comes with its own numbers and file name', async (t) => {
  const domainId = t.context.domain.id
  await seed(domainId)
  await Ga4Daily.create({
    domainId,
    date: new Date().toISOString().slice(0, 10),
    dimension: 'pages',
    value: 'example.com/ga',
    views: 5,
  })

  const path = `/export/pages.json?domainId=${domainId}&range=LAST_7_DAYS`
  const ga4 = await get(`${path}&source=GA4`, t.context.token.id)
  const ackee = await get(path, t.context.token.id)

  t.is(ga4.status, 200)
  t.regex(ga4.headers.get('content-disposition'), /filename="ackee-pages-ga4-\d{4}-\d{2}-\d{2}\.json"$/)
  t.deepEqual(
    JSON.parse(text(ga4.body)).map((entry) => [entry.value, entry.count]),
    [['https://example.com/ga', 5]],
  )
  t.deepEqual(
    JSON.parse(text(ackee.body)).map((entry) => [entry.value, entry.count]),
    [['https://example.com/', 3]],
  )
})

test.serial('an unknown source is 400', async (t) => {
  const { status } = await get(`/export/pages.json?source=MATOMO`, t.context.token.id)

  t.is(status, 400)
})

test.serial('a limit above the maximum is 400 and leaves a trace, the maximum itself is fine', async (t) => {
  const { token, domain } = t.context
  const statusOf = async (path) => (await get(`${path}&domainId=${domain.id}`, token.id)).status

  t.is(await statusOf('/export/views.json?limit=366'), 200)
  t.is(await statusOf('/export/pages.json?limit=1000'), 200)

  for (const path of [
    '/export/views.json?limit=367',
    '/export/views.json?limit=50000000',
    '/export/durations.json?limit=367',
    '/export/pages.json?limit=1001',
    '/export/pages.json?limit=0',
    '/export/pages.json?limit=-1',
    '/export/pages.json?limit=1e9',
    '/export/pages.json?limit=many',
  ]) {
    t.is(await statusOf(path), 400, path)
  }

  t.true(await audited({ action: 'export.views', details: /limit must be/ }, 1))
})

// Two pages today, one of them from the news, and a page of ten days ago
const seedScope = async (domainId) => {
  const page = (siteLocation, siteReferrer, created) => ({
    domainId,
    siteLocation,
    siteReferrer,
    created,
    updated: created,
  })
  const now = new Date()
  const past = new Date(Date.now() - 10 * 86_400_000)

  await Record.insertMany([
    page('https://example.com/cart', 'https://news.example/', now),
    page('https://example.com/', null, now),
    page('https://example.com/old', null, past),
  ])

  return past.toISOString().slice(0, 10)
}

const values = async (path, token) => {
  const { status, body } = await get(path, token)
  return { status, entries: status === 200 ? JSON.parse(text(body)) : [] }
}

test.serial('a filter narrows the report as on the dashboard', async (t) => {
  const { domain, token } = t.context
  await seedScope(domain.id)
  const path = `/export/pages.json?domainId=${domain.id}&range=LAST_7_DAYS`

  const filter = encodeURIComponent('SITE_REFERRER:https://news.example/')
  const filtered = await values(`${path}&filter=${filter}`, token.id)
  t.deepEqual(
    filtered.entries.map((entry) => entry.value),
    ['https://example.com/cart'],
  )

  // Without a value: the views that have no such field
  const direct = await values(`${path}&filter=SITE_REFERRER`, token.id)
  t.deepEqual(
    direct.entries.map((entry) => entry.value),
    ['https://example.com/'],
  )

  const both = await values(
    `${path}&filter=${filter}&filter=SITE_LOCATION:${encodeURIComponent('https://x.example/')}`,
    token.id,
  )
  t.deepEqual(both.entries, [])
})

test.serial('a period replaces the range of a list and sets the length of a chart', async (t) => {
  const { domain, token } = t.context
  const day = await seedScope(domain.id)
  const query = `domainId=${domain.id}&from=${day}&to=${day}`

  const list = await values(`/export/pages.json?${query}&range=LAST_24_HOURS`, token.id)
  t.deepEqual(
    list.entries.map((entry) => entry.value),
    ['https://example.com/old'],
  )

  // The limit of the card does not cut a period, the period is bounded on its own
  const long = await values(`/export/views.json?domainId=${domain.id}&from=2020-01-01&to=2020-12-31&limit=7`, token.id)
  t.is(long.entries.length, 366)
  t.is(long.entries[0].value, '2020-12-31')
})

test.serial('a wrong filter or period is 400 and leaves a trace', async (t) => {
  const { domain, token } = t.context
  const statusOf = async (query) => (await get(`/export/views.json?domainId=${domain.id}&${query}`, token.id)).status

  for (const query of [
    'filter=PASSWORD:x',
    'from=2026-01-01',
    'to=2026-01-01',
    'from=2026-13-01&to=2026-13-02',
    'from=2000-01-01&to=2026-01-01',
    'from=2026-02-01&to=2026-01-01',
    'filter=SOURCE:x&source=GA4',
    'from=2026-01-01&to=2026-01-02&source=GA4',
  ]) {
    t.is(await statusOf(query), 400, query)
  }

  t.true(await audited({ action: 'export.views', details: /^error/ }, 8))
})

test('cells with a comma, a quote or a line break are quoted', (t) => {
  const csv = toCsv(
    ['value', 'count'],
    [
      { value: 'a, "b"\nc', count: 3 },
      { value: null, count: 0 },
    ],
  )

  t.is(csv, '\u{FEFF}value,count\r\n"a, ""b""\nc",3\r\n,0\r\n')
})

test('a cell that starts with a space or a line break gets the quote as well', (t) => {
  const csv = toCsv(['value'], [{ value: ' =1+1' }, { value: '\n=1+1' }, { value: '\u{A0}=1+1' }, { value: 'a =1' }])

  t.is(csv, `\u{FEFF}value\r\n' =1+1\r\n"'\n=1+1"\r\n'\u{A0}=1+1\r\na =1\r\n`)
})

test.serial('a CSV has the same ISO dates as a JSON', async (t) => {
  const { domain, token } = t.context
  await seed(domain.id)
  const path = `domainId=${domain.id}&type=ONLY_SOURCE&sorting=RECENT`

  const json = await values(`/export/referrers.json?${path}`, token.id)
  const { body } = await get(`/export/referrers.csv?${path}`, token.id)

  const dates = text(body)
    .slice(1)
    .trim()
    .split('\r\n')
    .slice(1)
    .map((line) => line.split(',').at(-1))

  t.is(dates.length, 3)
  t.deepEqual(
    dates,
    json.entries.map((entry) => entry.created),
  )
})

test.serial('a repeated parameter is 400 and leaves a trace, filter may repeat', async (t) => {
  const { domain, token } = t.context
  await seed(domain.id)
  const other = await Domain.create({ title: 'Other', workspaceId: DEFAULT_WORKSPACE_ID })

  for (const query of [
    `domainId=${domain.id}&domainId=${other.id}`,
    `domainId=${domain.id}&source=GA4&source=GA4`,
    `domainId=${domain.id}&limit=1&limit=2`,
    `domainId=${domain.id}&delimiter=semicolon&delimiter=comma`,
    `domainId=${domain.id}&from=2026-01-01&from=2026-01-02&to=2026-01-03`,
  ]) {
    const { status, body } = await get(`/export/pages.csv?${query}`, token.id)
    t.is(status, 400, query)
    t.regex(JSON.parse(text(body)).error, /more than once/, query)
  }

  t.true(await audited({ action: 'export.pages', details: new RegExp(`more than once.*${domain.id}`) }, 5))
  // Both ids of the attempt, as the entry has no single target
  t.true(await audited({ details: new RegExp(String.raw`"domainId":\["${domain.id}","${other.id}"\]`) }, 1))
})

test.serial('the audit log has the source, the filters and the period of an export', async (t) => {
  const { domain, token } = t.context
  const filter = encodeURIComponent('SITE_LOCATION:https://example.com/')

  const period = await get(
    `/export/pages.csv?domainId=${domain.id}&from=2026-01-01&to=2026-01-02&filter=${filter}&filter=SITE_REFERRER`,
    token.id,
  )
  t.is(period.status, 200)

  const ga4 = await get(`/export/pages.json?domainId=${domain.id}&source=GA4`, token.id)
  t.is(ga4.status, 200)

  t.true(await audited({ action: 'export.pages', targetId: domain.id }, 2))
  const csv = await AuditLog.findOne({ targetId: domain.id, details: /^ok csv \{/ }).lean()
  const json = await AuditLog.findOne({ targetId: domain.id, details: /^ok json \{/ }).lean()

  const args = JSON.parse(csv.details.slice('ok csv '.length))
  t.is(args.from, '2026-01-01')
  t.is(args.to, '2026-01-02')
  t.deepEqual(args.filter, ['SITE_LOCATION:https://example.com/', 'SITE_REFERRER'])
  t.is(JSON.parse(json.details.slice('ok json '.length)).source, 'GA4')
})

test.serial('the caller cannot push the source out of the audit entry', async (t) => {
  const { domain, token } = t.context

  await get(`/export/pages.json?junk=${'x'.repeat(300)}&domainId=${domain.id}&source=GA4`, token.id)

  t.true(await audited({ action: 'export.pages', details: /^ok json \{"source":"GA4"/ }, 1))
})

test.serial('an internal error is 500 with a generic message, and is logged', async (t) => {
  const { domain, token } = t.context
  const { aggregate } = Record
  const { error: logError } = signale
  const logged = []

  Record.aggregate = () => {
    throw new Error('Unknown domain of mongodb://root@db.internal')
  }
  signale.error = (message) => logged.push(message)
  t.teardown(() => {
    Record.aggregate = aggregate
    signale.error = logError
  })

  const { status, headers, body } = await get(`/export/pages.json?domainId=${domain.id}`, token.id)

  t.is(status, 500)
  t.is(headers.get('cache-control'), 'no-store')
  t.deepEqual(JSON.parse(text(body)), { error: 'The export failed' })
  t.is(logged.length, 1)
  t.regex(logged[0], /db\.internal/)

  // The audit log is read in the dashboard, so the raw message stays out of it too
  t.true(await audited({ action: 'export.pages', details: /^error: The export failed json/ }, 1))
  t.is(await AuditLog.countDocuments({ details: /db\.internal/ }), 0)
})

test.serial('an expected error stays 400 with its message and is not logged as a fault', async (t) => {
  const { domain, token } = t.context
  const { error: logError } = signale
  const logged = []

  signale.error = (message) => logged.push(message)
  t.teardown(() => {
    signale.error = logError
  })

  const messageOf = async (query) => {
    const { status, body } = await get(`/export/views.json?domainId=${domain.id}&${query}`, token.id)
    return [status, JSON.parse(text(body)).error]
  }

  t.deepEqual(await messageOf('limit=367'), [400, 'The limit must be from 1 to 366'])
  t.deepEqual(await messageOf('from=2026-01-01'), [400, 'A period needs both from and to'])
  t.deepEqual(await messageOf('from=2026-02-01&to=2026-01-01'), [400, 'The period ends before it starts'])
  t.deepEqual(await messageOf('filter=SOURCE:x&source=GA4'), [
    400,
    'Filters and periods are only available for the views collected by Ackee',
  ])

  const [status, message] = await messageOf('filter=PASSWORD:x')
  t.is(status, 400)
  t.regex(message, /PASSWORD/)

  t.deepEqual(logged, [])
})
