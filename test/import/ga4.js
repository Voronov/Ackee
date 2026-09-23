import test from 'ava'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expandRow, readCountry, readDate, readHeader, readRows, splitRow } from '../../src/import/ga4.js'

const write = async (name, content) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ackee-ga4-'))
  const file = path.join(directory, name)

  await writeFile(file, content)

  return file
}

test('a quoted field may hold the separator', (t) => {
  t.deepEqual(splitRow('a,"b,c",d'), ['a', 'b,c', 'd'])
  t.deepEqual(splitRow('"say ""hi""",x'), ['say "hi"', 'x'])
})

test('both date shapes are understood', (t) => {
  t.is(readDate('20260922').toISOString(), '2026-09-22T00:00:00.000Z')
  t.is(readDate('2026-09-22').toISOString(), '2026-09-22T00:00:00.000Z')
  t.is(readDate('not a date'), null)
})

test('a header is recognised by its columns, whatever they are called', (t) => {
  const mapping = readHeader('Date,Page path and screen class,Views,Country')

  t.is(mapping.date, 0)
  t.is(mapping.path, 1)
  t.is(mapping.views, 2)
  t.is(mapping.country, 3)
})

test('a header needs a count and at least one dimension', (t) => {
  // GA4 puts several lines of metadata above the table. This is how they get skipped.
  t.is(readHeader('# Start date: 20260101'), null)
  t.is(readHeader('Country,Browser'), null)

  // The most common export, "Pages and screens", carries no date at all. Requiring one
  // would reject the very file people arrive with.
  t.not(readHeader('Page path and screen class,Views'), null)
})

test('a row becomes as many records as it counts', (t) => {
  const mapping = readHeader('Date,Page path,Views,Country,Session source,Browser')
  const values = splitRow('20260922,/pricing,3,Ukraine,google,Safari')

  const records = expandRow({ values, mapping, domainId: 'domain-1', origin: 'https://example.com' })

  t.is(records.length, 3)
  t.is(records[0].siteLocation, 'https://example.com/pricing')
  t.is(records[0].country, 'UA')
  t.is(records[0].siteReferrer, 'https://google')
  t.is(records[0].browserName, 'Safari')

  // Spread across the day rather than piled at midnight, so a daily report looks like
  // traffic instead of one spike.
  t.true(records[0].created < records[1].created)
  t.true(records[2].created < new Date('2026-09-23T00:00:00.000Z'))

  // No visitor hash: an aggregate cannot say who the visits belonged to, and inventing
  // one would make unique views look real when they are not.
  t.is(records[0].clientId, undefined)
})

test('(direct) is no referrer at all', (t) => {
  const mapping = readHeader('Date,Page path,Views,Session source')

  for (const source of ['(direct)', '(none)', '']) {
    const [record] = expandRow({
      values: splitRow(`20260922,/,1,${source}`),
      mapping,
      domainId: 'domain-1',
      origin: 'https://example.com',
    })

    t.is(record.siteReferrer, null, `"${source}" should not become a referrer`)
  }
})

test('a row counting nothing produces nothing', (t) => {
  const mapping = readHeader('Date,Page path,Views')

  t.is(expandRow({ values: splitRow('20260922,/,0'), mapping, domainId: 'd', origin: 'https://e.com' }).length, 0)
  t.is(expandRow({ values: splitRow('nonsense,/,5'), mapping, domainId: 'd', origin: 'https://e.com' }).length, 0)
})

// GA4 exports country names, not codes. Slicing two letters off "Ukraine" gives UK, which
// is the United Kingdom — wrong data rather than missing data.
test('country names become the right codes', (t) => {
  t.is(readCountry('Ukraine'), 'UA')
  t.is(readCountry('United Kingdom'), 'GB')
  t.is(readCountry('Germany'), 'DE')

  // A code passes through, and anything unrecognised is left out rather than guessed.
  t.is(readCountry('ua'), 'UA')
  t.is(readCountry('Middle Earth'), null)
})

test('an export without dates uses the one it is given', (t) => {
  const mapping = readHeader('Page path and screen class,Views')
  const fallbackDate = new Date('2026-09-22T00:00:00.000Z')

  const records = expandRow({
    values: splitRow('/pricing,2'),
    mapping,
    domainId: 'domain-1',
    origin: 'https://example.com',
    fallbackDate,
  })

  t.is(records.length, 2)
  t.true(records[0].created >= fallbackDate)
})

test('the metadata block above a real export is skipped', async (t) => {
  const file = await write(
    'export.csv',
    [
      '# ----------------------------------------',
      '# All Users',
      '# Pages and screens: Page path and screen class',
      '# 20260901-20260922',
      '# ----------------------------------------',
      '',
      'Page path and screen class,Views',
      '/,120',
      '/pricing,45',
    ].join('\n'),
  )

  const rows = []
  for await (const row of readRows(file)) rows.push(row)

  // The commented block is passed over, the real header is consumed as the mapping, and
  // the two data rows come through.
  t.is(rows.length, 2)
  t.is(rows[0].values[0], '/')
})

test('rows are read once the header is found', async (t) => {
  const file = await write(
    'export.csv',
    ['# note', 'Date,Page path,Views', '20260922,/,2', '20260923,/pricing,1'].join('\n'),
  )

  const rows = []
  for await (const row of readRows(file)) rows.push(row)

  t.is(rows.length, 2)
  t.is(rows[0].values[1], '/')
})
