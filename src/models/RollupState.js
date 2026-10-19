import mongoose from 'mongoose'

// The range for which a domain's rollups actually exist.
//
// Without it, reading rollups would quietly undercount: a missing bucket looks exactly
// like a bucket with no events. The read path checks this range and falls back to raw
// records when a report window does not fit inside it.
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
    unique: true,
  },
  // Start of the earliest bucket built.
  from: {
    type: Date,
    required: true,
  },
  // End of the range: the first bucket not built yet.
  to: {
    type: Date,
    required: true,
  },
  // Spike ACKEE-15: start of the first day whose unique-views buckets may still change.
  // Records lose their clientId when the same visitor comes back on the same day, so a
  // bucket is final only once the day has ended and the bucket was rebuilt after that.
  sealed: {
    type: Date,
  },
  updated: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

export default mongoose.model('RollupState', schema)
