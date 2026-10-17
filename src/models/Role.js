import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { PERMISSIONS } from '../constants/permissions.js'
import { SCHEMA_VERSION } from '../constants/workspaces.js'

// A role defined in the database rather than in code, so adding one needs no release.
const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  name: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: 50,
  },
  permissions: {
    type: [{ type: String, enum: PERMISSIONS }],
    required: true,
    default: [],
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

export default mongoose.model('Role', schema)
