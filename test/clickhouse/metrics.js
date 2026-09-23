import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'

import { close, getClient } from '../../src/clickhouse/client.js'
import { ensureSchema } from '../../src/clickhouse/schema.js'
import { INTERVALS_DAILY } from '../../src/constants/intervals.js'
import { VIEWS_TYPE_TOTAL } from '../../src/constants/views.js'
import { registry } from '../../src/utils/metrics.js'
import * as clickhouse from '../../src/stores/clickhouse/index.js'
import { flush } from '../../src/stores/clickhouse/writer.js'
import createDate from '../../src/utils/createDate.js'

const database = `ackee_test_${uuid().replaceAll('-', '')}`

const restore = mockedEnv({ ACKEE_CLICKHOUSE_DATABASE: database })

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

test.before(async () => {
  await ensureSchema(database)
})

test.after.always(async () => {
  await getClient().command({ query: 'DROP DATABASE IF EXISTS {database:Identifier}', query_params: { database } })
  await close()
  restore()
})

test.serial('reports the buffered rows and times the flush', async (t) => {
  const domainId = uuid()

  t.is(await valueOf('ackee_clickhouse_flush_seconds_count'), 0)

  clickhouse.addRecord({ domainId, clientId: 'client', siteLocation: 'https://example.com/' })
  clickhouse.addRecord({ domainId, clientId: 'client', siteLocation: 'https://example.com/' })

  t.is(await valueOf('ackee_clickhouse_buffer_rows'), 2)

  await flush()

  t.is(await valueOf('ackee_clickhouse_buffer_rows'), 0)
  t.is(await valueOf('ackee_clickhouse_flush_seconds_count'), 1)
  t.is(await valueOf('ackee_clickhouse_flush_seconds_bucket', { le: '+Inf' }), 1)
  t.true((await valueOf('ackee_clickhouse_flush_seconds_sum')) > 0)
  t.is(await valueOf('ackee_clickhouse_insert_errors_total'), 0)
  t.is(await valueOf('ackee_clickhouse_dropped_rows_total'), 0)
})

test.serial('times a report under its name and the clickhouse store', async (t) => {
  const domainId = uuid()

  clickhouse.addRecord({ domainId, clientId: 'client', siteLocation: 'https://example.com/' })
  await flush()

  t.is(await valueOf('ackee_report_seconds_count', { report: 'views', store: 'clickhouse' }), undefined)

  const entries = await clickhouse.views([domainId], VIEWS_TYPE_TOTAL, INTERVALS_DAILY, 7, createDate('UTC'))

  t.is(entries.length, 7)
  t.is(entries[0].count, 1)
  t.is(await valueOf('ackee_report_seconds_count', { report: 'views', store: 'clickhouse' }), 1)
  t.true((await valueOf('ackee_report_seconds_sum', { report: 'views', store: 'clickhouse' })) > 0)
  t.is(await valueOf('ackee_report_seconds_count', { report: 'views', store: 'mongo' }), undefined)
})
