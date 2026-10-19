import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'
import Domain from '../models/Domain.js'
import Event from '../models/Event.js'

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
