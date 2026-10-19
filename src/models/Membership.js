import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { ROLE_VIEWER } from '../constants/roles.js'
import { SCHEMA_VERSION } from '../constants/workspaces.js'

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
    // Any role name: built-in or stored in the database (ACKEE-13). An unknown one grants nothing.
    default: ROLE_VIEWER,
  },
  // Empty means every domain of the workspace. An invitation limited to some domains sets it,
  // and such a member sees nothing else of the workspace: no other domains, no events.
  domainIds: {
    type: [String],
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

// One role per user and workspace. Also serves the lookup by `userId` on each request.
schema.index({ userId: 1, workspaceId: 1 }, { unique: true })

export default mongoose.model('Membership', schema)
