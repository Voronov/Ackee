import mongoose from 'mongoose'

// One hour of events, grouped by one dimension.
//
// An hour rather than a day: interval reports group by the visitor's time zone, which
// `aggregations/aggregateViews.js` passes into `$dayOfMonth`. A daily bucket in UTC would
// give wrong numbers everywhere except UTC. An hourly bucket regroups into any zone whose
// offset is a whole number of hours.
//
// A dimension is the set of record fields to group by: `siteLocation`, `source|siteReferrer`,
// `browserWidth|browserHeight` and so on. Keeping it generic avoids a branch per report.
const schema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
  },
  dimension: {
    type: String,
    required: true,
  },
  // A stable hash of `key`, needed for the unique index: `key` is an arbitrary object
  // and its values can exceed the MongoDB index key limit.
  keyHash: {
    type: String,
    required: true,
  },
  // The same shape as `_id` in the original `$group`, so the data layer keeps working
  // without changes.
  key: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  bucket: {
    type: Date,
    required: true,
  },
  count: {
    type: Number,
    required: true,
    default: 0,
  },
})

// Reads: every bucket of one dimension over a time range.
schema.index({ domainId: 1, dimension: 1, bucket: 1 })

// Writes: the idempotency key used when a range is rebuilt.
schema.index({ domainId: 1, dimension: 1, bucket: 1, keyHash: 1 }, { unique: true })

export default mongoose.model('Rollup', schema)
