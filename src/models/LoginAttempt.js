import mongoose from 'mongoose'

import { LOGIN_WINDOW } from '../constants/login.js'

// A failed sign-in. Only the count within the window matters, so MongoDB drops old ones itself.
const schema = new mongoose.Schema({
  // The address that was tried, lowercased. Not the IP: the limit protects the account.
  key: {
    type: String,
    required: true,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

schema.index({ key: 1 })
schema.index({ created: 1 }, { expireAfterSeconds: LOGIN_WINDOW / 1000 })

export default mongoose.model('LoginAttempt', schema)
