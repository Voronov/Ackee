import GaConnection from '../models/GaConnection.js'
import { decrypt, encrypt } from '../utils/secrets.js'

// The key never leaves this module. Everything above it sees the account address and the
// property, which is enough to tell one connection from another.
const response = (entry) => ({
  id: entry.id,
  domainId: entry.domainId,
  propertyId: entry.propertyId,
  serviceAccountEmail: entry.serviceAccountEmail,
  syncedUntil: entry.syncedUntil,
  lastError: entry.lastError,
  created: entry.created,
  updated: entry.updated,
})

const within = (workspaceIds) => ({ workspaceId: { $in: workspaceIds } })

export const add = async ({ domainId, propertyId, credentials }, workspaceId) => {
  const entry = await GaConnection.create({
    workspaceId,
    domainId,
    propertyId,
    serviceAccountEmail: credentials.client_email,
    credentials: encrypt(JSON.stringify(credentials)),
  })

  return response(entry)
}

export const forDomain = async (domainId, workspaceIds) => {
  const entry = await GaConnection.findOne({ domainId, ...within(workspaceIds) })

  return entry == null ? null : response(entry)
}

export const del = (domainId, workspaceIds) => GaConnection.findOneAndDelete({ domainId, ...within(workspaceIds) })

// Used by the sync job, which runs on a schedule rather than for a signed-in user.
export const all = () => GaConnection.find({}).lean()

export const credentialsOf = (entry) => JSON.parse(decrypt(entry.credentials))

export const markSynced = (id, syncedUntil) =>
  GaConnection.updateOne({ id }, { $set: { syncedUntil, lastError: null, updated: Date.now() } })

export const markFailed = (id, message) =>
  GaConnection.updateOne({ id }, { $set: { lastError: String(message).slice(0, 500), updated: Date.now() } })
