// Copies existing history from MongoDB into the columnar store.
// Run: npm run clickhouse:backfill
//
// Limit to one domain: ACKEE_DOMAIN=<id>
// Batch size: ACKEE_BATCH=50000
import mongoose from 'mongoose'

import Record from '../models/Record.js'
import { getClient, isEnabled, migrate } from '../utils/clickhouse.js'
import config from '../utils/config.js'
import connect from '../utils/connect.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'
import { insert } from './records.js'

if (config.dbUrl == null) {
  signale.fatal('MongoDB connection URI missing in environment')
  process.exit(1)
}

if (isEnabled() === false) {
  signale.fatal('ACKEE_CLICKHOUSE missing in environment')
  process.exit(1)
}

const BATCH = Number(process.env.ACKEE_BATCH || 50_000)
const domainId = process.env.ACKEE_DOMAIN

signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)
await connect(config.dbUrl)
await migrate()
signale.success('Connected')

const filter = domainId == null ? {} : { domainId }
const total = await Record.countDocuments(filter)

signale.start(`Copying ${total} records${domainId == null ? '' : ` of domain ${domainId}`}`)

const started = Date.now()
let done = 0
let batch = []

// A cursor rather than paging: `skip` over millions of documents gets quadratically
// slower, because each batch skips everything before it again.
const cursor = Record.find(filter).lean().batchSize(5000).cursor()

for await (const entry of cursor) {
  batch.push(entry)

  if (batch.length >= BATCH) {
    await insert(batch)
    done += batch.length
    batch = []

    const rate = Math.round(done / ((Date.now() - started) / 1000))
    signale.info(`  ${done}/${total} (${rate}/s)`)
  }
}

if (batch.length > 0) {
  await insert(batch)
  done += batch.length
}

// Async inserts return before the rows reach the table, so flush the buffer before
// counting.
await getClient().command({ query: 'SYSTEM FLUSH ASYNC INSERT QUEUE' })

const check = await getClient().query({
  query: 'SELECT count() AS total FROM records',
  format: 'JSONEachRow',
})
const [row] = await check.json()

signale.success(`Copied ${done} records in ${Math.round((Date.now() - started) / 1000)}s`)
signale.info(`ClickHouse now holds ${row.total} rows`)

await getClient().close()
await mongoose.disconnect()
