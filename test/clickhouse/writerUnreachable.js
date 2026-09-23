import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'

import { close } from '../../src/clickhouse/client.js'
import { registry } from '../../src/utils/metrics.js'
import { flush, maxBufferedRows, push, size, stats } from '../../src/stores/clickhouse/writer.js'
import signale from '../../src/utils/signale.js'

// Nothing listens on port 1, so every insert is refused immediately. The env is not
// restored: the rows kept for the next attempt retry on the timer after the test and
// must not reach the real ClickHouse of the npm script
mockedEnv({ ACKEE_CLICKHOUSE_URL: 'http://localhost:1' })

// Not restored either, so that retry does not print into the test output
const errors = []

signale.error = (message) => errors.push(message)

const valueOf = async (name, labels = {}) => {
  const metrics = await registry.getMetricsAsJSON()

  for (const metric of metrics) {
    for (const entry of metric.values) {
      if ((entry.metricName ?? metric.name) !== name) continue
      if (Object.entries(labels).every(([key, value]) => String(entry.labels[key]) === String(value))) {
        return entry.value
      }
    }
  }
}

test.after.always(async () => {
  await close()
})

test('keeps the buffer bounded, counts and times failed flushes when ClickHouse is unreachable', async (t) => {
  const pushed = maxBufferedRows + 10_000

  for (let index = 0; index < pushed; index++) {
    push('records', { id: uuid(), domainId: 'domain', created: new Date().toISOString(), version: 1 })
  }

  await flush()

  t.is(size(), maxBufferedRows)
  t.is(stats.dropped, pushed - maxBufferedRows)
  t.is(stats.errors, 2)
  t.is(await valueOf('ackee_clickhouse_flush_seconds_count'), 2)
  t.true(errors.includes('ClickHouse insert of 1000 rows into records failed twice: ECONNREFUSED'))
  t.true(errors.includes(`ClickHouse insert of ${maxBufferedRows} rows into records failed twice: ECONNREFUSED`))
  t.true(errors.includes(`ClickHouse buffer is full (${maxBufferedRows} rows), dropping new rows`))
})
