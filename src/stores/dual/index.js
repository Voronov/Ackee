import { anonymizeByIds } from '../../database/records.js'
import Action from '../../models/Action.js'
import Record from '../../models/Record.js'
import signale from '../../utils/signale.js'
import * as clickhouse from '../clickhouse/index.js'
import { stats } from '../clickhouse/writer.js'
import * as mongo from '../mongo/index.js'

export {
  views,
  pages,
  referrers,
  durations,
  systems,
  devices,
  browsers,
  sizes,
  languages,
  countries,
  activeVisitors,
  actionsChart,
  actionsList,
} from '../mongo/index.js'

// MongoDB is the source of truth: a ClickHouse failure is logged and counted, never
// returned to the tracker
const mirror = async (write) => {
  try {
    await write()
  } catch (error) {
    stats.errors++
    signale.error(`ClickHouse write failed: ${error.message}`)
  }
}

export const addRecord = async (data) => {
  const entry = await mongo.addRecord(data)
  await mirror(() => clickhouse.addRecord({ ...data, ...entry }))
  return entry
}

// The MongoDB response of a touch leaves out clientId and domainId, which are part of
// the ClickHouse sorting key, so the document is read back in full and pushed as it is
export const mirrorRecord = async (id) => {
  const record = await Record.findOne({ id }).lean()
  if (record == null) return record

  await mirror(() => clickhouse.touchRecord(record))
  return record
}

export const mirrorRecords = async (records) => {
  await mirror(() => clickhouse.mirrorRecords(records))
}

export const touchRecord = async (id, updated) => {
  const entry = await mongo.touchRecord(id, updated)
  if (entry == null) return entry

  await mirrorRecord(id)
  return entry
}

// The anonymized version only needs the fields that stay filled
const anonymizedProjection = 'id domainId siteLocation siteReferrer source created updated'

// MongoDB nulls exactly the records that get a version in ClickHouse, not whatever
// matches the clientId once the update runs: a record created in between keeps its
// clientId in both stores and is anonymized by the visitor's next event. Reading first
// is also what makes the set known, afterwards MongoDB no longer has the clientId.
export const anonymize = async (clientId, ignoreId) => {
  const records = await Record.find({ $and: [{ clientId }, { id: { $ne: ignoreId } }] })
    .select(anonymizedProjection)
    .lean()

  if (records.length === 0) return

  const result = await anonymizeByIds(records.map((record) => record.id))

  await mirror(() => clickhouse.anonymize(records))
  return result
}

export const deleteRecords = async (domainId) => {
  const result = await mongo.deleteRecords(domainId)
  await mirror(() => clickhouse.deleteRecords(domainId))
  return result
}

export const addAction = async (data) => {
  const entry = await mongo.addAction(data)
  await mirror(() => clickhouse.addAction({ ...data, ...entry }))
  return entry
}

export const mirrorAction = async (id) => {
  const action = await Action.findOne({ id }).lean()
  if (action == null) return action

  await mirror(() => clickhouse.touchAction(action))
  return action
}

export const touchAction = async (id, data) => {
  const entry = await mongo.touchAction(id, data)
  if (entry == null) return entry

  await mirrorAction(id)
  return entry
}

export const deleteActions = async (eventId) => {
  const result = await mongo.deleteActions(eventId)
  await mirror(() => clickhouse.deleteActions(eventId))
  return result
}
