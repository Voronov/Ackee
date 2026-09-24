import { describeError, close, getClient, ping } from '../clickhouse/client.js'
import { ensureSchema } from '../clickhouse/schema.js'
import Record from '../models/Record.js'
import config, { usesClickHouse } from '../utils/config.js'
import signale from '../utils/signale.js'
import stripUrlAuth from '../utils/stripUrlAuth.js'
import { flush, size } from './clickhouse/writer.js'

/*
 * The two counts never match exactly: ClickHouse holds a row per version of a record and
 * FINAL only folds the versions it can see, while a migration that is still running fills
 * the gap by itself. Half of MongoDB is far outside that noise and means the history was
 * never copied, which in `clickhouse` mode reads as zeros with nothing to explain them.
 */
const migrationRatio = 0.5

const warnAboutMissingHistory = async () => {
  const mongoRecords = await Record.estimatedDocumentCount()

  if (mongoRecords === 0) return

  const result = await getClient().query({
    query: 'SELECT count() AS count FROM {database:Identifier}.records FINAL',
    query_params: { database: config.clickhouseDatabase },
    format: 'JSONEachRow',
  })

  const [row] = await result.json()
  const clickhouseRecords = Number(row.count)

  if (clickhouseRecords >= mongoRecords * migrationRatio) return

  signale.warn(
    `ClickHouse holds ${clickhouseRecords} records while MongoDB holds about ${mongoRecords}. Reports are answered by ClickHouse alone and will show the missing history as zero. Run 'npm run clickhouse:migrate' to copy it over.`,
  )
}

// No-ops in mongo mode, so the API and the worker share one startup and shutdown path
export const connectEventStore = async () => {
  if (usesClickHouse() === false) return

  signale.await(`Connecting to ClickHouse at ${stripUrlAuth(config.clickhouseUrl)}`)
  await ping()
  await ensureSchema()
  signale.success(`ClickHouse schema '${config.clickhouseDatabase}' is ready (event store: ${config.eventStore})`)

  // Only when ClickHouse answers reports. In `dual` MongoDB does, so a store that lags
  // behind is the expected state rather than something to warn about, and counting the
  // MongoDB collection would be startup work with nothing to report.
  if (config.eventStore !== 'clickhouse') return

  // An operator may well start from an empty store on purpose, so this stays a warning:
  // refusing to start over it would be worse than the silent zeros it is warning about.
  try {
    await warnAboutMissingHistory()
  } catch (error) {
    signale.warn(`Could not compare the record counts of MongoDB and ClickHouse: ${describeError(error)}`)
  }
}

export const closeEventStore = async () => {
  if (usesClickHouse() === false) return

  await flush()

  if (size() > 0) signale.error(`${size()} rows could not be flushed to ClickHouse and are lost`)

  await close()
}
