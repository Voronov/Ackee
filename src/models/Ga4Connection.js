import mongoose from 'mongoose'

// A domain's link to a Google Analytics 4 property, read with a service account (ACKEE-21)
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
    unique: true,
  },
  propertyId: {
    type: String,
    required: true,
  },
  clientEmail: {
    type: String,
    required: true,
  },
  // The service account's private key, sealed with ACKEE_SECRET_KEY (utils/secretBox.js)
  privateKey: {
    type: String,
    required: true,
  },
  // Days the synced data covers, as YYYY-MM-DD
  firstDate: String,
  lastDate: String,
  lastSync: Date,
  lastError: String,
  // A sync in progress holds this lease, so two processes never pull the same property at once
  lockedUntil: Date,
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

export default mongoose.model('Ga4Connection', schema)
