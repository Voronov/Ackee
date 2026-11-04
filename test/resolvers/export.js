import test from 'ava'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import { toCsv } from '../../src/export.js'
import AuditLog from '../../src/models/AuditLog.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
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
  t.true(
    (await AuditLog.countDocuments({ workspaceId: workspace.id, action: 'export.referrers', details: /^error/ })) > 0,
  )
  t.is(await AuditLog.countDocuments({ workspaceId: t.context.workspace.id, userId: user.id }), 0)
})

test.serial('a wrong argument is 400', async (t) => {
  const { status, body } = await get(`/export/referrers.csv?range=FOREVER`, t.context.token.id)

  t.is(status, 400)
  t.regex(JSON.parse(text(body)).error, /FOREVER/)
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
