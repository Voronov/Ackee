import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { DEFAULT_WORKSPACE_ID, SCHEMA_VERSION } from '../constants/workspaces.js'

const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  title: {
    type: String,
    required: true,
    maxlength: 500,
  },
  // Until workspaces can be created (ACKEE-12), every domain is in the default one.
  workspaceId: {
    type: String,
    required: true,
    default: DEFAULT_WORKSPACE_ID,
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
  updated: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

schema.index({ workspaceId: 1 })

export default mongoose.model('Domain', schema)
