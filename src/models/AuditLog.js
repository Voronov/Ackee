import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { SCHEMA_VERSION } from '../constants/workspaces.js'

// Who changed what, and when. Written by the server only, never edited.
const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  userId: {
    type: String,
    required: true,
  },
  // Kept next to the id, so the entry still reads after the account is gone.
  email: {
    type: String,
  },
  workspaceId: {
    type: String,
    required: true,
  },
  // For example `domain.create`.
  action: {
    type: String,
    required: true,
  },
  targetId: {
    type: String,
  },
  schemaVersion: {
    type: Number,
    required: true,
    default: SCHEMA_VERSION,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

schema.index({ workspaceId: 1, created: -1 })

export default mongoose.model('AuditLog', schema)
