import mongoose from 'mongoose'

// How many records of one hour share the same values of a dimension, see constants/rollups.js.
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
  },
  dimension: {
    type: String,
    required: true,
  },
  // Start of the hour in UTC
  hour: {
    type: Date,
    required: true,
  },
  // Every field of the dimension, null when the record had none. The reports filter on null
  // just like they do on records.
  fields: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  count: {
    type: Number,
    required: true,
  },
})

schema.index({ domainId: 1, dimension: 1, hour: 1 })
// Building a range deletes it across all domains first
schema.index({ hour: 1 })

export default mongoose.model('DimensionRollup', schema)
