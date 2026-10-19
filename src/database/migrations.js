import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import Domain from '../models/Domain.js'
import Event from '../models/Event.js'
import Record from '../models/Record.js'

const missing = { workspaceId: { $exists: false } }

/*
 * Domains and events from before workspaces have no `workspaceId` in the database.
 *
 * The schema default only applies when a document is created or read into a model, not to
 * a query filter, so every scoped query would skip them and they would disappear for
 * everyone. Running at start moves them into the default workspace once.
 */
export const assignDefaultWorkspace = async () => {
  const update = { $set: { workspaceId: DEFAULT_WORKSPACE_ID } }

  const [domains, events] = await Promise.all([Domain.updateMany(missing, update), Event.updateMany(missing, update)])

  return { domains: domains.modifiedCount, events: events.modifiedCount }
}

/*
 * ACKEE-7 replaced the single-field index on `domainId` with the compound one. Mongoose
 * creates indexes at start but never drops one, so a database from before keeps paying
 * for the old index on every insert until it is dropped here.
 */
export const dropOldRecordIndexes = async () => {
  const indexes = await Record.collection.indexes().catch((error) => {
    // A new installation has no records collection yet
    if (error.codeName === 'NamespaceNotFound') return []
    throw error
  })

  if (indexes.some((index) => index.name === 'domainId_1') === false) return false

  await Record.collection.dropIndex('domainId_1')

  return true
}
