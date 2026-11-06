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

// Every list of an event matches on both fields (stages/matchEvents.js), as the reports of a
// domain do on Record. The compound index also serves a match on eventId alone.
schema.index({ eventId: 1, created: 1 })

export default mongoose.model('Action', schema)
