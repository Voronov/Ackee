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
      // No database is bound: every query and insert names it, and Ackee must be able to
      // set up a server that does not have the database yet
      log: { LoggerClass: Logger, level: ClickHouseLogLevel.ERROR },
      clickhouse_settings: {
        // Rows carry ISO timestamps with a zone. `basic`, the default before 26.x, rejects
        // them outright, so the format is pinned rather than inherited from the server.
        date_time_input_format: 'best_effort',
      },
    })
  }

  return client
}

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
