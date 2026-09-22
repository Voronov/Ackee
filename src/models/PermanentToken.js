import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  title: {
    type: String,
    required: true,
    maxlength: 500,
  },
  // An API token belongs to whoever created it and carries their access. Without this
  // field a token has no identity, which is how version 1.0 worked.
  userId: {
    type: String,
    required: true,
  },
  created: {
    type: Date,
    required: true,
    default: Date.now,
  },
  updated: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

export default mongoose.model('PermanentToken', schema)
