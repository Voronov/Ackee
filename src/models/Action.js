import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  eventId: {
    type: String,
    required: true,
  },
  key: {
    type: String,
    maxlength: 500,
  },
  value: {
    type: Number,
  },
  details: {
    type: String,
    maxlength: 2000,
  },
  created: {
    type: Date,
    required: true,
    index: true,
    default: Date.now,
  },
  updated: {
    type: Date,
    required: true,
    index: true,
    default: Date.now,
  },
})

// Event reports filter by event and a time range, then group, the same shape the record
// reports have. Without the compound index the planner reads an event's whole history.
schema.index({ eventId: 1, created: 1 })

export default mongoose.model('Action', schema)
