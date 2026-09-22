import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

// The email address is also the login. Its format is checked when someone registers,
// not here, so that a stored address is never rejected by a later rule change.
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
  // A scrypt hash with its parameters and salt. See utils/password.js.
  password: {
    type: String,
    required: true,
  },
  // An account is created unconfirmed and activated by a link sent to the address.
  // Confirmation by email is not built yet, so accounts start confirmed for now.
  verified: {
    type: Boolean,
    required: true,
    default: false,
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
