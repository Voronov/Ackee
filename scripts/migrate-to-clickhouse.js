import mongoose from 'mongoose'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { close, getClient, ping } from '../src/clickhouse/client.js'
import { ensureSchema } from '../src/clickhouse/schema.js'
import Action from '../src/models/Action.js'
import Record from '../src/models/Record.js'
import { actionRow, recordRow } from '../src/stores/clickhouse/index.js'
import { insert } from '../src/stores/clickhouse/writer.js'
import config from '../src/utils/config.js'
import connect from '../src/utils/connect.js'
import signale from '../src/utils/signale.js'
import { second } from '../src/utils/times.js'

export const defaults = {
  batch: 10000,
}

const checkpointId = 'clickhouse'
const progressEvery = 10

// Why `updated` is the version: see "Migrated history" in src/stores/clickhouse/SEMANTICS.md
const versionOf = (table, document) => {
  if (document.updated == null) throw new Error(`${table} ${document.id} has no updated`)
  return document.updated.getTime()
}

const tables = [
  { name: 'records', model: Record, toRow: (document) => recordRow(document, versionOf('records', document)) },
  { name: 'actions', model: Action, toRow: (document) => actionRow(document, versionOf('actions', document)) },
]

export const parseOptions = (args) => {
  const { values } = parseArgs({
    args,
    options: {
      'batch': { type: 'string', default: String(defaults.batch) },
      'from': { type: 'string' },
      'reset': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'stop-after': { type: 'string' },
    },
  })

  const toInteger = (name) => {
    const value = values[name]
    if (/^\d+$/.test(value) === false || Number(value) < 1) {
      throw new Error(`Option --${name} must be a positive integer`)
    }
    return Number(value)
  }

  const from = values.from == null ? undefined : new Date(values.from).getTime()
  if (Number.isNaN(from)) throw new Error('Option --from must be a valid date')

  return {
    batch: toInteger('batch'),
    from,
    reset: values.reset,
    dryRun: values['dry-run'],
    stopAfter: values['stop-after'] == null ? undefined : toInteger('stop-after'),
  }
}

const checkpoints = () => mongoose.connection.collection('migrations')

const readCheckpoint = async () => (await checkpoints().findOne({ id: checkpointId })) ?? {}

const saveCheckpoint = (table, position) =>
  checkpoints().updateOne({ id: checkpointId }, { $set: { [table]: position } }, { upsert: true })

const resetCheckpoint = () => checkpoints().deleteOne({ id: checkpointId })

// Documents are visited in (created, _id) order, so everything after the checkpoint is
// either created later or created in the same millisecond with a higher _id
const filterFrom = (from, position) => {
  if (from != null) return { created: { $gte: new Date(from) } }
  if (position == null) return {}

  return {
    $or: [{ created: { $gt: position.created } }, { created: position.created, _id: { $gt: position._id } }],
  }
}

const countFinal = async (table) => {
  const result = await getClient().query({
    query: 'SELECT count() AS count FROM {database:Identifier}.{table:Identifier} FINAL',
    query_params: { database: config.clickhouseDatabase, table },
    format: 'JSONEachRow',
  })
  const [row] = await result.json()
  return Number(row.count)
}

const logProgress = (name, migrated, total, startedAt) => {
  const elapsed = Math.max(1, Date.now() - startedAt)
  const rate = Math.round((migrated / elapsed) * second)
  const eta = Math.round((total - migrated) / Math.max(1, rate))

  signale.await(`${name}: ${migrated}/${total} migrated, ${rate} rows/s, ETA ${eta}s`)
}

const migrateTable = async ({ name, model, toRow }, options, state) => {
  const filter = filterFrom(options.from, state.checkpoint[name])
  const total = await model.countDocuments(filter)

  if (total === 0) {
    signale.info(`${name}: nothing to do`)
    return 0
  }

  const batches = Math.ceil(total / options.batch)

  if (options.dryRun === true) {
    signale.info(`${name}: dry run, ${total} documents would be migrated in ${batches} batches of ${options.batch}`)
    return total
  }

  signale.info(`${name}: migrating ${total} documents in ${batches} batches of ${options.batch}`)

  // No index covers the (created, _id) sort, so MongoDB sorts the whole selection once
  // before the first batch arrives and has to be allowed to spill it to disk
  const cursor = model
    .find(filter)
    .sort({ created: 1, _id: 1 })
    .lean()
    .allowDiskUse(true)
    .cursor({ batchSize: options.batch })

  const startedAt = Date.now()
  let batch = []
  let migrated = 0

  // The checkpoint moves only after the insert succeeded: an interrupted batch is
  // inserted again on the next run and collapses in ClickHouse. A `--from` run leaves
  // the checkpoint alone, it is a partial copy the next regular run must not skip over.
  const flush = async () => {
    await insert(name, batch.map(toRow))

    const last = batch.at(-1)
    if (options.from == null) await saveCheckpoint(name, { created: last.created, _id: last._id })

    migrated += batch.length
    state.batches++
    batch = []

    if (state.batches === options.stopAfter) state.stopped = true
    if (state.batches % progressEvery === 0) logProgress(name, migrated, total, startedAt)
  }

  for await (const document of cursor) {
    batch.push(document)
    if (batch.length < options.batch) continue

    await flush()
    if (state.stopped === true) break
  }

  if (batch.length > 0) await flush()

  const elapsed = Math.max(1, Date.now() - startedAt)
  const verb = state.stopped === true ? 'stopped after' : 'migrated'
  signale.success(`${name}: ${verb} ${migrated}/${total} documents in ${(elapsed / second).toFixed(1)}s`)

  return migrated
}

const statusOf = (mongo, clickhouse, partial) => {
  if (mongo === clickhouse) return 'ok'
  return partial === true ? 'partial run, counts are expected to differ' : 'MISMATCH'
}

const report = async (partial) => {
  const counts = {}

  for (const { name, model } of tables) {
    const mongo = await model.countDocuments({})
    const clickhouse = await countFinal(name)

    counts[name] = { mongo, clickhouse }
    signale.info(`${name}: MongoDB ${mongo}, ClickHouse ${clickhouse} (${statusOf(mongo, clickhouse, partial)})`)
  }

  return counts
}

export const run = async (options) => {
  if (options.reset === true) {
    await resetCheckpoint()
    signale.info('Checkpoint reset')
  }

  const state = { checkpoint: await readCheckpoint(), batches: 0, stopped: false }
  const migrated = {}

  if (options.from != null) {
    signale.info(`Starting from ${new Date(options.from).toISOString()}, checkpoint ignored and left as it is`)
  }

  for (const table of tables) {
    migrated[table.name] = state.stopped === true ? 0 : await migrateTable(table, options, state)
  }

  if (state.stopped === true) signale.warn(`Stopped after ${state.batches} batches, run again to continue`)
  if (options.dryRun === true) return { migrated, stopped: state.stopped }

  const partial = options.from != null || state.stopped === true

  return { migrated, stopped: state.stopped, partial, counts: await report(partial) }
}

const parseOrExit = (args) => {
  try {
    return parseOptions(args)
  } catch (error) {
    signale.fatal(error.message)
    process.exit(1)
  }
}

const main = async () => {
  const options = parseOrExit(process.argv.slice(2))

  if (config.dbUrl == null) throw new Error('MongoDB connection URI missing in environment')
  if (options.dryRun === false && config.clickhouseUrl == null) throw new Error('ACKEE_CLICKHOUSE_URL is required')

  await connect(config.dbUrl)

  if (options.dryRun === false) {
    await ping()
    await ensureSchema()
  }

  const { counts, partial } = await run(options)

  await mongoose.disconnect()
  await close()

  if (partial === true) return

  const hasMismatch = Object.values(counts ?? {}).some(({ mongo, clickhouse }) => mongo !== clickhouse)

  if (hasMismatch === true) {
    signale.error('Counts differ between MongoDB and ClickHouse')
    process.exit(1)
  }
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename

if (isMain === true) {
  main().catch((error) => {
    signale.fatal(error)
    process.exit(1)
  })
}
