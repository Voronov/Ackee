import mongoose from 'mongoose'

/*
 * One day of a GA4 property, as GA4 reports it: totals, or the views per value of one dimension.
 * Aggregates only, and kept apart from Ackee's records: GA counts with cookies and Ackee without,
 * so mixing them would make both wrong (ACKEE-21).
 */
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
  },
  // YYYY-MM-DD in the property's time zone
  date: {
    type: String,
    required: true,
  },
  // "total", or a key of GA4_DIMENSIONS
  dimension: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    default: '',
  },
  views: {
    type: Number,
    default: 0,
  },
  users: Number,
  sessions: Number,
  // Seconds, summed over sessions, so days add up before the average is taken
  durationSum: Number,
})

schema.index({ domainId: 1, dimension: 1, date: 1 })

export default mongoose.model('Ga4Daily', schema)
