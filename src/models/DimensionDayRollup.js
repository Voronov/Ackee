import mongoose from 'mongoose'

// The rollups of a dimension summed per day (ACKEE-74). A month of TOP reads ≈30 of these per
// combination instead of ≈720 hourly ones. Built from the hourly rollups once all 24 hours of a
// day are built, see database/rollups.js.
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
  },
  dimension: {
    type: String,
    required: true,
  },
  // Start of the day in UTC. The window of a report starts at any hour, the hourly rollups
  // fill up to the first whole day.
  day: {
    type: Date,
    required: true,
  },
  fields: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  count: {
    type: Number,
    required: true,
  },
})

schema.index({ domainId: 1, dimension: 1, day: 1 })
// Building a range deletes it across all domains first
schema.index({ day: 1 })

export default mongoose.model('DimensionDayRollup', schema)
