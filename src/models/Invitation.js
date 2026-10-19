import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { ROLE_VIEWER } from '../constants/roles.js'
import { day } from '../utils/times.js'

// An invitation into a workspace, sent by email. Like the one-time links of UserToken only
// a hash of the token is stored. Unlike them it belongs to an address, not to a user: the
// invited person may not have an account yet.
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
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    maxlength: 320,
  },
  role: {
    type: String,
    required: true,
    default: ROLE_VIEWER,
  },
  // Empty means every domain of the workspace, see Membership
  domainIds: {
    type: [String],
    default: [],
  },
  invitedBy: {
    type: String,
    required: true,
  },
  hash: {
    type: String,
    required: true,
    unique: true,
  },
  // A used or revoked invitation stays until it expires, so its link says "already used"
  used: {
    type: Boolean,
    required: true,
    default: false,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expires: {
    type: Date,
    required: true,
    default: () => Date.now() + 7 * day,
  },
})

// MongoDB removes expired invitations by itself
schema.index({ expires: 1 }, { expireAfterSeconds: 0 })
schema.index({ workspaceId: 1, email: 1 })

export default mongoose.model('Invitation', schema)
