import mongoose from 'mongoose'

// What the views and durations reports need from one hour of a domain's records.
// Every value is a sum, so hours add up to days, months and years in any time zone
// whose offset is a whole number of hours.
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
  },
  // Start of the hour in UTC
  hour: {
    type: Date,
    required: true,
  },
  total: {
    type: Number,
    required: true,
  },
  // Records that still carry a clientId. This is what the UNIQUE report counts, and unlike
  // distinct visitors it can be summed across hours.
  unique: {
    type: Number,
    required: true,
  },
  // A sum and a count instead of an average, so hours can be combined
  durationSum: {
    type: Number,
    required: true,
  },
  durationCount: {
    type: Number,
    required: true,
  },
})

schema.index({ domainId: 1, hour: 1 })
// Building a range deletes it across all domains first
schema.index({ hour: 1 })

export default mongoose.model('ViewRollup', schema)
