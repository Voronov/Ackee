import config from '../utils/config.js'
import { getBootstrapClient, getClient } from './client.js'

const createDatabase = `
  CREATE DATABASE IF NOT EXISTS {database:Identifier}
`

// Column names mirror src/models/Record.js. Rows are never updated in place: every
// change Mongo makes to a record (touch, anonymize) is inserted as a new row with the
// same (domainId, created, id) and a higher version, and ReplacingMergeTree keeps the
// latest one when merging, so reads must use FINAL. clientId has no TTL on purpose:
// Mongo keeps it on the last record of each visitor and unique views and active
// visitors count on it, so anonymization is mirrored only through anonymized versions.
const createRecords = `
  CREATE TABLE IF NOT EXISTS {database:Identifier}.records (
    id String,
    clientId String,
    domainId String,
    siteLocation String,
    siteReferrer Nullable(String),
    siteLanguage LowCardinality(Nullable(String)),
    country LowCardinality(Nullable(String)),
    source Nullable(String),
    screenWidth Nullable(UInt32),
    screenHeight Nullable(UInt32),
    screenColorDepth Nullable(UInt32),
    deviceName LowCardinality(Nullable(String)),
    deviceManufacturer LowCardinality(Nullable(String)),
    osName LowCardinality(Nullable(String)),
    osVersion LowCardinality(Nullable(String)),
    browserName LowCardinality(Nullable(String)),
    browserVersion LowCardinality(Nullable(String)),
    browserWidth Nullable(UInt32),
    browserHeight Nullable(UInt32),
    created DateTime64(3),
    updated DateTime64(3),
    version UInt64
  )
  ENGINE = ReplacingMergeTree(version)
  PARTITION BY toYYYYMM(created)
  ORDER BY (domainId, created, id)
`

const createActions = `
  CREATE TABLE IF NOT EXISTS {database:Identifier}.actions (
    id String,
    eventId String,
    key Nullable(String),
    value Nullable(Float64),
    details Nullable(String),
    created DateTime64(3),
    updated DateTime64(3),
    version UInt64
  )
  ENGINE = ReplacingMergeTree(version)
  PARTITION BY toYYYYMM(created)
  ORDER BY (eventId, created, id)
`

export const ensureSchema = async (database = config.clickhouseDatabase) => {
  const parameters = { database }

  // The regular client binds the database, which does not exist yet on a fresh server
  const bootstrap = getBootstrapClient()

  try {
    await bootstrap.command({ query: createDatabase, query_params: parameters })
  } finally {
    await bootstrap.close()
  }

  const client = getClient()

  await client.command({ query: createRecords, query_params: parameters })
  await client.command({ query: createActions, query_params: parameters })
}
