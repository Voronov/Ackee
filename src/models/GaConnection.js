import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

// A link between one Ackee domain and one Google Analytics property.
//
// The credentials are a Google service account key, stored encrypted. They open the user's
// Google account rather than ours, so a copy of this collection must not be enough to use
// them — see utils/secrets.js.
const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  workspaceId: {
    type: String,
    required: true,
  },
  domainId: {
    type: String,
    required: true,
  },
  // The numeric property id from Analytics, not the G-XXXXXXXXXX measurement id.
  propertyId: {
    type: String,
    required: true,
  },
  // Shown so the owner can tell which account they connected without being able to read
  // the key itself.
  serviceAccountEmail: {
    type: String,
    required: true,
  },
  credentials: {
    type: String,
    required: true,
  },
  // The last day already imported. Syncing continues from the day after, so a run that
  // fails halfway repeats that day rather than skipping it.
  syncedUntil: {
    type: Date,
  },
  lastError: {
    type: String,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
  updated: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

// One property per domain: importing the same data twice would double every number.
schema.index({ domainId: 1 }, { unique: true })
schema.index({ workspaceId: 1 })

export default mongoose.model('GaConnection', schema)
