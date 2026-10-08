import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { day } from '../utils/times.js'

// One-time links sent by email: confirming an address and resetting a password.
//
// Only a hash of the token is stored, for the same reason as passwords. A leaked database
// should not hand anyone a working link to take over an account.
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
  purpose: {
    type: String,
    required: true,
    enum: ['VERIFY', 'RESET'],
  },
  hash: {
    type: String,
    required: true,
    unique: true,
  },
  // A used token stays in the collection until it expires, so that following the same
  // link twice says "already used" instead of "unknown link".
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
    default: () => Date.now() + day,
  },
})

// MongoDB removes expired tokens by itself, so nothing has to sweep them.
schema.index({ expires: 1 }, { expireAfterSeconds: 0 })
schema.index({ userId: 1, purpose: 1 })

export default mongoose.model('UserToken', schema)
