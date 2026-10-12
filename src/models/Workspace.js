import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { SCHEMA_VERSION } from '../constants/workspaces.js'

// The unit of data isolation. Domains belong to a workspace, not to a user (ADR-002).
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

export default mongoose.model('Workspace', schema)
