// Disk and row counts of every variant on the stand: MongoDB records and rollups, the
// ClickHouse tables of B and the materialized views of C.
//
//   ACKEE_MONGODB=… ACKEE_CLICKHOUSE=… ACKEE_CLICKHOUSE_PASSWORD=… node tools/spike-15/sizes.js
import mongoose from 'mongoose'

import { getClient } from '../../src/clickhouse/client.js'
import config from '../../src/utils/config.js'
import { connectStand, disconnectStand, markdownTable } from './stand.js'

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1)

await connectStand()

const mongoRows = []

for (const name of ['records', 'rollups', 'rollupstates']) {
  const [stats] = await mongoose.connection.db
    .collection(name)
    .aggregate([{ $collStats: { storageStats: {} } }])
    .toArray()
    .catch(() => [])

  if (stats == null) continue

  const { count, size, storageSize, totalIndexSize } = stats.storageStats
  mongoRows.push([name, count, mib(size), mib(storageSize), mib(totalIndexSize)])
}

process.stdout.write(
  markdownTable(['MongoDB collection', 'Documents', 'Data, MiB', 'On disk, MiB', 'Indexes, MiB'], mongoRows),
)

const dimensions = await mongoose.connection.db
  .collection('rollups')
  .aggregate([{ $group: { _id: '$dimension', documents: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  .toArray()

process.stdout.write(
  `\n${markdownTable(
    ['Rollup dimension', 'Documents'],
    dimensions.map((entry) => [entry._id, entry.documents]),
  )}`,
)

if (config.clickhouseUrl != null) {
  const result = await getClient().query({
    query: `
      SELECT table, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS disk,
        sum(data_compressed_bytes) AS compressed, sum(data_uncompressed_bytes) AS uncompressed
      FROM system.parts
      WHERE database = {database:String} AND active
      GROUP BY table
      ORDER BY table
    `,
    query_params: { database: config.clickhouseDatabase },
    format: 'JSONEachRow',
    clickhouse_settings: { output_format_json_quote_64bit_integers: 0 },
  })

  const tables = await result.json()

  process.stdout.write(
    `\n${markdownTable(
      ['ClickHouse table', 'Active parts', 'Rows', 'On disk, MiB', 'Compressed, MiB', 'Uncompressed, MiB'],
      tables.map((table) => [
        table.table,
        table.parts,
        table.rows,
        mib(table.disk),
        mib(table.compressed),
        mib(table.uncompressed),
      ]),
    )}`,
  )
}

await disconnectStand()
