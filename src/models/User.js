import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { SCHEMA_VERSION } from '../constants/workspaces.js'

// The email address is also the login.
const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 320,
  },
  // A scrypt hash (utils/password.js). The env admin has none and signs in with the env.
  password: {
    type: String,
  },
  // Registered accounts cannot sign in until the address is confirmed.
  verified: {
    type: Boolean,
    required: true,
    default: false,
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

export default mongoose.model('User', schema)
