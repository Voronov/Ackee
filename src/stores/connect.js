import { close, ping } from '../clickhouse/client.js'
import { ensureSchema } from '../clickhouse/schema.js'
import config, { usesClickHouse } from '../utils/config.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'
import { flush, size } from './clickhouse/writer.js'

// No-ops in mongo mode, so the API and the worker share one startup and shutdown path
export const connectEventStore = async () => {
  if (usesClickHouse() === false) return

  signale.await(`Connecting to ClickHouse at ${stripUrlAuth(config.clickhouseUrl)}`)
  await ping()
  await ensureSchema()
  signale.success(`ClickHouse schema '${config.clickhouseDatabase}' is ready (event store: ${config.eventStore})`)
}

export const closeEventStore = async () => {
  if (usesClickHouse() === false) return

  await flush()

  if (size() > 0) signale.error(`${size()} rows could not be flushed to ClickHouse and are lost`)

  await close()
}
