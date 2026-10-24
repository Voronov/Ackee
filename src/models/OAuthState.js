import mongoose from 'mongoose'

import { minute } from '../utils/times.js'

// One sign-in with an external provider in progress (ACKEE-79). Holds what the callback has to
// check: the PKCE verifier and the nonce. Keyed by a hash of `state`, like the other tokens.
const schema = new mongoose.Schema({
  hash: {
    type: String,
    required: true,
    unique: true,
  },
  codeVerifier: {
    type: String,
    required: true,
  },
  nonce: {
    type: String,
    required: true,
  },
  used: {
    type: Boolean,
    required: true,
    default: false,
  },
  expires: {
    type: Date,
    required: true,
    default: () => Date.now() + 10 * minute,
  },
})

// MongoDB removes abandoned sign-ins by itself
schema.index({ expires: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('OAuthState', schema)
