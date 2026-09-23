import { createClient } from '@clickhouse/client'

import config from './config.js'
import signale from './signale.js'

// The columnar event store. It runs next to MongoDB rather than instead of it: events
// are written to both, and reads are switched over by a separate flag. Rolling back is
// then an environment change, not a data migration.
let client = null

export const isEnabled = () => config.clickhouseUrl != null && config.clickhouseUrl !== ''

export const getClient = () => {
  if (isEnabled() === false) return null

  client ??= createClient({
    url: config.clickhouseUrl,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
    database: config.clickhouseDatabase,
    clickhouse_settings: {
      // Tracking inserts are small and frequent. Async inserts batch them on the server;
      // otherwise every event would create its own table part.
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  })

  return client
}

// The sort order matches the shape of every report: domain first, then time. That pair
// is what each aggregation matches on, so a report reads one contiguous range instead of
// scanning the table.
//
// ReplacingMergeTree on `updated` is needed because Ackee extends a visit with a second
// request. The row arrives again with a newer `updated`, and the latest one wins on merge.
//
// `clientId` is deliberately absent. Unique views are counted in MongoDB, because their
// meaning depends on erasing the hash from older records, which here would mean rewriting
// millions of rows. As a side effect, no visitor hash is stored in this database at all.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id UUID,
  domainId UUID,
  siteLocation String,
  siteReferrer Nullable(String),
  source Nullable(String),
  siteLanguage Nullable(String),
  country Nullable(String),
  screenWidth Nullable(UInt32),
  screenHeight Nullable(UInt32),
  screenColorDepth Nullable(UInt16),
  deviceName Nullable(String),
  deviceManufacturer Nullable(String),
  osName Nullable(String),
  osVersion Nullable(String),
  browserName Nullable(String),
  browserVersion Nullable(String),
  browserWidth Nullable(UInt32),
  browserHeight Nullable(UInt32),
  created DateTime64(3, 'UTC'),
  updated DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated)
PARTITION BY toYYYYMM(created)
ORDER BY (domainId, created, id)
`

let ready = null

// The database name comes from the environment, so from an operator rather than a user.
// It is still interpolated into a query as text, so check its shape: a typo in the variable
// would otherwise become arbitrary SQL.
const isValidDatabaseName = (name) => /^[A-Za-z][\w$]*$/.test(name)

const create = async () => {
  const database = config.clickhouseDatabase

  if (isValidDatabaseName(database) === false) {
    throw new Error(`Invalid ClickHouse database name: ${database}`)
  }

  // A client with no database bound: Ackee should be able to set up an empty server itself
  // rather than rely on the image having created the database on first start.
  const bootstrap = createClient({
    url: config.clickhouseUrl,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
  })

  try {
    await bootstrap.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` })
  } finally {
    await bootstrap.close()
  }

  await getClient().command({ query: SCHEMA })
  signale.info('ClickHouse schema ready')
}

export const migrate = () => {
  if (isEnabled() === false) return Promise.resolve()

  ready ??= create()

  return ready
}
