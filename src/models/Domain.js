import mongoose from 'mongoose'
import { randomBytes, randomUUID as uuid } from 'node:crypto'

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
  // Sent by the tracker alongside the domain id.
  //
  // This is not a secret: it sits in the snippet on a public page, so anyone who opens
  // the site can read it. What it buys is a higher bar — you have to visit the site
  // rather than read an id out of someone's source — and a way for the owner to rotate
  // it when that is not enough.
  ingestKey: {
    type: String,
    required: true,
    default: () => randomBytes(16).toString('base64url'),
  },
  // While this is off, events are accepted with or without a key, so an existing snippet
  // keeps working. The owner turns it on once the snippet on their site carries the key.
  strictIngest: {
    type: Boolean,
    required: true,
    default: false,
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
