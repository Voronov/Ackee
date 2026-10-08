import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  // A domain belongs to a workspace rather than to a user. Roles only mean something
  // when there is shared ground to describe (ADR-002).
  workspaceId: {
    type: String,
    required: true,
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

// Every domain query is limited to the viewer's workspaces, so this is the main path.
schema.index({ workspaceId: 1 })

export default mongoose.model('Domain', schema)
