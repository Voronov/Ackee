import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import Action from '../models/Action.js'
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
const dropOldIndex = async (Model, name) => {
  const indexes = await Model.collection.indexes().catch((error) => {
    // A new installation has no such collection yet
    if (error.codeName === 'NamespaceNotFound') return []
    throw error
  })

  if (indexes.some((index) => index.name === name) === false) return false

  // Other processes start at the same time and may drop it first
  return Model.collection.dropIndex(name).then(
    () => true,
    (error) => {
      if (error.code === 27) return false
      throw error
    },
  )
}

export const dropOldRecordIndexes = () => dropOldIndex(Record, 'domainId_1')

// The same for the actions of events (ACKEE-75): `eventId` became part of a compound index
export const dropOldActionIndexes = () => dropOldIndex(Action, 'eventId_1')
