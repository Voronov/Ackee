import mongoose from 'mongoose'

import { minute } from '../utils/times.js'

// A challenge handed to the browser for one passkey ceremony (ACKEE-80). It works once and
// only for its purpose; a registration challenge also only for the user who asked for it.
const schema = new mongoose.Schema({
  challenge: {
    type: String,
    required: true,
    unique: true,
  },
  purpose: {
    type: String,
    required: true,
    enum: ['REGISTER', 'AUTHENTICATE'],
  },
  userId: {
    type: String,
  },
  used: {
    type: Boolean,
    required: true,
    default: false,
  },
  expires: {
    type: Date,
    required: true,
    default: () => Date.now() + 5 * minute,
  },
})

schema.index({ expires: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('WebAuthnChallenge', schema)
