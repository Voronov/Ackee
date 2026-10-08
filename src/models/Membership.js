import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { ROLE_VIEWER, ROLES } from '../constants/roles.js'

// A user's role in a workspace. A collection rather than an array on the workspace:
// every request looks this up by `userId`, which needs an index.
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
  workspaceId: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
    enum: ROLES,
    default: ROLE_VIEWER,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

// Reads: every workspace of a user. Runs on each API request.
schema.index({ userId: 1 })

// Writes: a user cannot hold two roles in the same workspace.
schema.index({ userId: 1, workspaceId: 1 }, { unique: true })

export default mongoose.model('Membership', schema)
