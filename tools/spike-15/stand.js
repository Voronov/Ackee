import mongoose from 'mongoose'

import { close as closeClickHouse } from '../../src/clickhouse/client.js'
import Domain from '../../src/models/Domain.js'
import config from '../../src/utils/config.js'
import connect from '../../src/utils/connect.js'

// Shared by the spike tools, which run against the benchmark stand of ACKEE-2.

// The stand's MongoDB also serves v1.0. An index Mongoose builds on `records` by itself
// would change what v1.0 is measured on, so the tools never let it.
export const connectStand = async () => {
  process.env.ACKEE_AUTO_INDEX = 'false'

  if (config.dbUrl == null) throw new Error('ACKEE_MONGODB is missing')

  await connect(config.dbUrl)
}

export const disconnectStand = async () => {
  await mongoose.disconnect()
  await closeClickHouse()
}

// Day boundaries (createDate, the salt, the seal of unique views) follow the process time
// zone. The stand's Ackee runs in UTC, so a tool in any other zone would compare other days.
export const requireUtc = () => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  if (timeZone !== 'UTC') throw new Error(`Run with TZ=UTC, the stand's server runs in UTC (this process: ${timeZone})`)
}

export const resolveDomainId = async (domainId) => {
  if (domainId != null) return domainId

  const domains = await Domain.find().select('id title').lean()
  if (domains.length === 1) return domains[0].id

  throw new Error(`Pass --domain, the stand has ${domains.length} domains`)
}

export const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export const markdownTable = (header, rows) =>
  `${[
    `| ${header.join(' | ')} |`,
    `| ${header.map((column) => '-'.repeat(column.length)).join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')}\n`
