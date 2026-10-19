import mongoose from 'mongoose'

// Which hours the rollups cover. There is one document: the rollups of all domains are built
// together, one range of hours at a time.
const schema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'records',
  },
  // Rollups exist for every hour in [from, until). Reports read records outside of it.
  from: {
    type: Date,
  },
  until: {
    type: Date,
  },
  // The process that builds rollups holds this lease, see ROLLUP_LEASE
  lockedUntil: {
    type: Date,
  },
})

export default mongoose.model('RollupState', schema)
