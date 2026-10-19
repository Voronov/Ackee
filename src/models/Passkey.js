import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

// A WebAuthn credential a user signs in with (ACKEE-80). Only the public key is stored: the
// private one never leaves the authenticator.
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
    index: true,
  },
  // Base64url, as the browser sends it
  credentialId: {
    type: String,
    required: true,
    unique: true,
  },
  publicKey: {
    type: String,
    required: true,
  },
  // Grows with every use on authenticators that count. A smaller one means a cloned key.
  counter: {
    type: Number,
    required: true,
    default: 0,
  },
  transports: {
    type: [String],
    default: [],
  },
  name: {
    type: String,
    required: true,
    maxlength: 100,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
  lastUsed: {
    type: Date,
  },
})

export default mongoose.model('Passkey', schema)
