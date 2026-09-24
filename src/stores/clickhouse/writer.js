import { performance } from 'node:perf_hooks'

import { describeError, getClient } from '../../clickhouse/client.js'
import { gauge, histogram, readCounter } from '../../utils/metrics.js'
import config from '../../utils/config.js'
import signale from '../../utils/signale.js'

export const batchSize = 1000
export const flushInterval = 1000
export const maxBufferedRows = 50_000

export const stats = { errors: 0, dropped: 0 }

const buffers = new Map()
let total = 0
let timer
let pending
let isDropping = false

export const size = () => total

gauge('ackee_clickhouse_buffer_rows', 'Rows waiting in the ClickHouse write buffer', size)
readCounter('ackee_clickhouse_insert_errors_total', 'ClickHouse writes that failed', () => stats.errors)
readCounter(
  'ackee_clickhouse_dropped_rows_total',
  'Rows dropped because the ClickHouse write buffer was full',
  () => stats.dropped,
)
const flushSeconds = histogram(
  'ackee_clickhouse_flush_seconds',
  'Duration of one ClickHouse insert batch, retry included',
)

const rowsOf = (table) => {
  if (buffers.has(table) === false) buffers.set(table, [])
  return buffers.get(table)
}

export const insert = (table, rows) =>
  getClient().insert({
    table: `${config.clickhouseDatabase}.${table}`,
    values: rows,
    format: 'JSONEachRow',
  })

const insertWithRetry = async (table, rows) => {
  const started = performance.now()

  try {
    await insert(table, rows)
  } catch {
    await insert(table, rows)
  } finally {
    flushSeconds.observe((performance.now() - started) / 1000)
  }
}

// A failed batch goes back to the front of the buffer for the next flush, so a short
// outage loses nothing. What does not fit under the limit is dropped, so a long
// outage cannot grow the process without bound. The oldest rows are the ones kept:
// what reaches ClickHouse then stays a contiguous prefix of what MongoDB holds, and a
// gap at the end can be backfilled from MongoDB while holes in the middle cannot.
const requeue = (table, rows) => {
  const kept = rows.slice(0, Math.max(0, maxBufferedRows - total))

  stats.dropped += rows.length - kept.length
  buffers.set(table, [...kept, ...rowsOf(table)])
  total += kept.length
}

const flushNow = async () => {
  clearTimeout(timer)
  timer = undefined

  const batches = [...buffers.entries()].filter(([, rows]) => rows.length > 0)

  buffers.clear()
  total = 0

  let hasFailed = false

  for (const [table, rows] of batches) {
    try {
      await insertWithRetry(table, rows)
      isDropping = false
    } catch (error) {
      hasFailed = true
      stats.errors++
      signale.error(`ClickHouse insert of ${rows.length} rows into ${table} failed twice: ${describeError(error)}`)
      requeue(table, rows)
    }
  }

  return hasFailed
}

// Rows pushed during a flush have no timer of their own: a timer that fired meanwhile
// only found the flush already running. Once the flush is over a waiting full batch
// goes out at once and anything smaller gets the timer back. After a failure the
// requeued rows wait for the timer as well, or an outage would become a hot retry loop.
const scheduleNext = (hasFailed) => {
  pending = undefined

  if (total === 0) return
  if (hasFailed === false && total >= batchSize) requestFlush()
  else armTimer()
}

// Only one flush runs at a time. Rows pushed while it runs are picked up by the next one.
const requestFlush = () => {
  if (pending == null) {
    pending = flushNow().then(scheduleNext)
  }

  return pending
}

const armTimer = () => {
  if (timer != null) return

  timer = setTimeout(() => {
    timer = undefined
    requestFlush()
  }, flushInterval)

  // Buffered rows must not keep the process alive on their own
  timer.unref()
}

export const push = (table, row) => {
  if (total >= maxBufferedRows) {
    stats.dropped++

    if (isDropping === false) {
      isDropping = true
      signale.error(`ClickHouse buffer is full (${maxBufferedRows} rows), dropping new rows`)
    }

    return
  }

  rowsOf(table).push(row)
  total++
  armTimer()

  if (total >= batchSize) requestFlush()
}

// Resolves once every row pushed before the call has been inserted, requeued after a
// failed insert, or dropped
export const flush = async () => {
  if (pending != null) await pending

  await requestFlush()
}
