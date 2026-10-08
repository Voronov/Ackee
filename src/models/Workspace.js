import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

// The unit of data isolation. Domains belong to a workspace rather than to a user,
// because roles only mean something when there is shared ground to describe (ADR-002).
//
// Registering creates a personal workspace, so a single user never has to think about it.
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

export default mongoose.model('Workspace', schema)
