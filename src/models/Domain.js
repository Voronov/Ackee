import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { DEFAULT_WORKSPACE_ID, SCHEMA_VERSION } from '../constants/workspaces.js'

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
  // Sent by the tracker alongside the domain id.
  //
  // This is not a secret: it sits in the snippet on a public page, so anyone who opens
  // the site can read it. What it buys is a higher bar — you have to visit the site
  // rather than read an id out of someone's source — and a way for the owner to rotate
  // it when that is not enough.
  //
  // No default here: a default would give a domain from before keys a new random key on
  // every read without storing it. The data layer issues and stores it (database/domains.js).
  ingestKey: {
    type: String,
  },
  // While this is off, events are accepted with or without a key, so an existing snippet
  // keeps working. The owner turns it on once the snippet on their site carries the key.
  strictIngest: {
    type: Boolean,
    required: true,
    default: false,
  },
  // A domain belongs to a workspace rather than to a user (ADR-002). Domains from before
  // workspaces are in the default one.
  workspaceId: {
    type: String,
    required: true,
    default: DEFAULT_WORKSPACE_ID,
  },
  schemaVersion: {
    type: Number,
    required: true,
    default: SCHEMA_VERSION,
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

schema.index({ workspaceId: 1 })

export default mongoose.model('Domain', schema)
