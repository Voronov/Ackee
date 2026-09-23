import { ClickHouseLogLevel, createClient } from '@clickhouse/client'

import config from '../utils/config.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'

// Node reports a refused connection as an AggregateError with an empty message,
// so the code is the only readable part
export const describeError = (error) => error.message || error.code

// The library's default logger dumps stack traces to the console. Route it through
// signale like the rest of the app and drop warnings: the library already surfaces
// them to the caller (thrown errors, ping result), so logging them only duplicates.
class Logger {
  trace() {}
  debug() {}
  info() {}
  warn() {}
  error({ module, message, err }) {
    signale.error(`ClickHouse ${module}: ${message} (${describeError(err)})`)
  }
}

let client

export const getClient = () => {
  if (client == null) {
    client = createClient({
      url: config.clickhouseUrl,
      username: config.clickhouseUser,
      password: config.clickhousePassword,
      database: config.clickhouseDatabase,
      log: { LoggerClass: Logger, level: ClickHouseLogLevel.ERROR },
      clickhouse_settings: {
        // Tracking inserts are small and frequent. Async inserts batch them on the server;
        // otherwise every event would create its own table part.
        async_insert: 1,
        wait_for_async_insert: 0,
      },
    })
  }

  return client
}

// A client with no database bound, so an empty server can be set up by Ackee itself
// rather than relying on the image having created the database on first start.
export const getBootstrapClient = () =>
  createClient({
    url: config.clickhouseUrl,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
    log: { LoggerClass: Logger, level: ClickHouseLogLevel.ERROR },
  })

// The library's ping resolves with { success: false } instead of throwing,
// but callers want a single failure path at startup
export const ping = async () => {
  const result = await getClient().ping()

  if (result.success === false) {
    throw new Error(
      `ClickHouse at ${stripUrlAuth(config.clickhouseUrl)} is unreachable: ${describeError(result.error)}`,
    )
  }
}

export const close = async () => {
  if (client == null) return

  await client.close()
  client = undefined
}
