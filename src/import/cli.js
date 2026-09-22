// Imports a Google Analytics 4 CSV export into a domain.
//
// Run: npm run import:ga4 -- --domain <id> --file <export.csv> [--origin https://example.com]
//                          [--date 2026-09-22] [--limit 100]
//
// --date is needed for an export without a date column, which is most of them.
// --limit caps how many records one row expands into, for trying the import out first.
//
// The origin is taken from the domain title when that is a host name, because GA4 exports
// carry paths rather than full addresses.
import mongoose from 'mongoose'

import * as domains from '../database/domains.js'
import { insert as insertIntoClickhouse } from '../clickhouse/records.js'
import Record from '../models/Record.js'
import { migrate as clickhouseMigrate } from '../utils/clickhouse.js'
import config from '../utils/config.js'
import connect from '../utils/connect.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'
import { expandRow, readDate, readRows } from './ga4.js'

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? null : process.argv[index + 1]
}

const domainId = argument('domain')
const file = argument('file')
const limit = argument('limit') == null ? null : Number(argument('limit'))

// The most common export, "Pages and screens", has no date column. One has to be given.
const fallbackDate = argument('date') == null ? null : readDate(argument('date'))

if (config.dbUrl == null) {
  signale.fatal('MongoDB connection URI missing in environment')
  process.exit(1)
}

if (domainId == null || file == null) {
  signale.fatal('Usage: npm run import:ga4 -- --domain <id> --file <export.csv> [--origin https://example.com]')
  process.exit(1)
}

signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)
await connect(config.dbUrl)
await clickhouseMigrate()

const domain = await domains.getUnscoped(domainId)

if (domain == null) {
  signale.fatal(`Unknown domain ${domainId}`)
  process.exit(1)
}

// A domain titled "example.com" gives the origin away. Anything else has to be told.
const origin = argument('origin') ?? (domain.title.includes('.') === true ? `https://${domain.title}` : null)

if (origin == null) {
  signale.fatal(`Cannot guess the site address from the domain title "${domain.title}". Pass --origin.`)
  process.exit(1)
}

if (argument('date') != null && fallbackDate == null) {
  signale.fatal(`Cannot read --date "${argument('date')}". Use 2026-09-22 or 20260922.`)
  process.exit(1)
}

signale.start(`Importing ${file} into ${domain.title} as ${origin}`)

const BATCH = 10_000
const started = Date.now()
let batch = []
let rows = 0
let records = 0

const flush = async () => {
  if (batch.length === 0) return

  await Record.insertMany(batch, { ordered: false })
  await insertIntoClickhouse(batch)

  records += batch.length
  batch = []

  signale.info(`  ${rows} rows, ${records} records (${Math.round(records / ((Date.now() - started) / 1000))}/s)`)
}

for await (const row of readRows(file)) {
  rows++
  batch.push(...expandRow({ ...row, domainId: domain.id, origin, limit, fallbackDate }))

  if (batch.length >= BATCH) await flush()
}

await flush()

signale.success(`Imported ${records} records from ${rows} rows in ${Math.round((Date.now() - started) / 1000)}s`)
signale.warn('Imported records carry no visitor hash, so unique views over this period will read low')

await mongoose.disconnect()
