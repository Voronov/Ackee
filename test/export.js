import test from 'ava'
import listen from 'test-listen'

import server from '../src/server.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from './resolvers/_utils.js'

const base = listen(server)

const download = async (path, token) => {
  const url = new URL(path, await base)

  const result = await fetch(url.href, {
    headers: token == null ? {} : { Authorization: `Bearer ${token}` },
  })

  return { status: result.status, headers: result.headers, text: await result.text() }
}

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('export countries as csv', async (t) => {
  const { status, headers, text } = await download(`/export/${t.context.domain.id}/countries.csv`, t.context.token.id)

  t.is(status, 200)
  t.true(headers.get('content-type').startsWith('text/csv'))
  t.true(headers.get('content-disposition').includes('Example-countries.csv'))

  const [header, ...rows] = text.replace('﻿', '').trim().split('\n')

  // The name for a person reading the file, the code for a machine reading it.
  t.is(header, 'value,code,count')

  // The fixture writes 10 records from Ukraine and 4 from Germany.
  t.true(rows.includes('Ukraine,UA,10'))
  t.true(rows.includes('Germany,DE,4'))

  // The internal identifier has no meaning outside the instance and is left out.
  t.false(header.includes('id'))

  // `created` is only filled in by the "recent" sorting, so it is not a column here.
  t.false(header.includes('created'))
})

test.serial('export views as json', async (t) => {
  const { status, headers, text } = await download(`/export/${t.context.domain.id}/views.json`, t.context.token.id)

  t.is(status, 200)
  t.true(headers.get('content-type').startsWith('application/json'))

  const rows = JSON.parse(text)

  t.true(Array.isArray(rows))
  t.true(rows.length > 0)
  t.true('count' in rows[0])
})

test.serial('quote a field that holds a comma', async (t) => {
  const { text } = await download(`/export/${t.context.domain.id}/pages.csv`, t.context.token.id)

  // Every line has the same number of unquoted separators, or a reader would shift the
  // columns of that row.
  const lines = text.replace('﻿', '').trim().split('\n')
  const separators = (line) => line.replaceAll(/"[^"]*"/g, '').split(',').length

  t.true(lines.every((line) => separators(line) === separators(lines[0])))
})

test.serial('reject an unknown report', async (t) => {
  const { status } = await download(`/export/${t.context.domain.id}/nonsense.csv`, t.context.token.id)

  t.is(status, 404)
})

test.serial('reject a request without a token', async (t) => {
  const { status } = await download(`/export/${t.context.domain.id}/countries.csv`)

  t.is(status, 401)
})

test.serial('a domain of another workspace does not exist', async (t) => {
  // A real identifier, but not one this viewer can reach.
  const { status } = await download('/export/00000000-0000-4000-8000-000000000000/countries.csv', t.context.token.id)

  t.is(status, 404)
})
