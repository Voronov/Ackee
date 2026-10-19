// Variant C of ACKEE-15: hourly materialized views over `records` for views and referrers.
//
//   ACKEE_CLICKHOUSE=… node tools/spike-15/mv.js setup   # create, fill from records FINAL, attach
//   ACKEE_CLICKHOUSE=… node tools/spike-15/mv.js drop
//
// A view only sees rows as they are inserted. Every touch or anonymization of a record is
// a new row version in B, so on live data these views count versions, not records; on the
// stand the migration inserted one final row per record, and the numbers agree with B.
// NOTES.md weighs what it takes to make C correct.
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'

import { getClient } from '../../src/clickhouse/client.js'
import config from '../../src/utils/config.js'
import signale from '../../src/utils/signale.js'
import { disconnectStand } from './stand.js'

const tables = {
  views_hourly: `
    CREATE TABLE IF NOT EXISTS {database:Identifier}.views_hourly (
      domainId String,
      hour DateTime('UTC'),
      total AggregateFunction(count),
      uniques AggregateFunction(count)
    )
    ENGINE = AggregatingMergeTree
    ORDER BY (domainId, hour)
  `,
  // Both keys are nullable, as they are in the report's GROUP BY
  referrers_hourly: `
    CREATE TABLE IF NOT EXISTS {database:Identifier}.referrers_hourly (
      domainId String,
      hour DateTime('UTC'),
      source Nullable(String),
      siteReferrer Nullable(String),
      total AggregateFunction(count)
    )
    ENGINE = AggregatingMergeTree
    ORDER BY (domainId, hour, source, siteReferrer)
    SETTINGS allow_nullable_key = 1
  `,
}

const selects = {
  views_hourly: `
    SELECT domainId, toStartOfHour(created) AS hour, countState() AS total, countIfState(clientId != '') AS uniques
    FROM {database:Identifier}.records{final}
    GROUP BY domainId, hour
  `,
  referrers_hourly: `
    SELECT domainId, toStartOfHour(created) AS hour, source, siteReferrer, countState() AS total
    FROM {database:Identifier}.records{final}
    WHERE source IS NOT NULL OR siteReferrer IS NOT NULL
    GROUP BY domainId, hour, source, siteReferrer
  `,
}

const command = (query) =>
  getClient().command({
    query,
    query_params: { database: config.clickhouseDatabase },
    clickhouse_settings: { do_not_merge_across_partitions_select_final: 1 },
  })

const timed = async (label, fn) => {
  const started = performance.now()
  await fn()
  const seconds = (performance.now() - started) / 1000
  signale.success(`${label}: ${seconds.toFixed(1)} s`)
  return seconds
}

const setup = async () => {
  const timings = {}

  for (const [table, ddl] of Object.entries(tables)) {
    await command(ddl)

    // The view is attached after the fill: rows inserted while the fill runs would
    // otherwise be counted by both.
    timings[table] = await timed(`fill ${table} from records FINAL`, () =>
      command(`INSERT INTO {database:Identifier}.${table} ${selects[table].replace('{final}', ' FINAL')}`),
    )

    await command(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS {database:Identifier}.${table}_mv TO {database:Identifier}.${table} AS ${selects[table].replace('{final}', '')}`,
    )
  }

  return timings
}

const drop = async () => {
  for (const table of Object.keys(tables)) {
    await command(`DROP VIEW IF EXISTS {database:Identifier}.${table}_mv`)
    await command(`DROP TABLE IF EXISTS {database:Identifier}.${table}`)
  }

  signale.success('Materialized views dropped')
}

const { positionals } = parseArgs({ allowPositionals: true })
const [action] = positionals

if (config.clickhouseUrl == null) throw new Error('ACKEE_CLICKHOUSE is missing')

if (action === 'setup') await setup()
else if (action === 'drop') await drop()
else throw new Error('Usage: mv.js setup | drop')

await disconnectStand()
