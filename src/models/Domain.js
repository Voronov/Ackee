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
  // What the site collects besides page views, set up here rather than in its code (ACKEE-25).
  // Served to the site by /t/<id>.js, see autotrack/loader.js.
  tracking: {
    gtmId: { type: String, default: '' },
    outbound: { type: Boolean, default: false },
    downloads: { type: Boolean, default: false },
    downloadExtensions: { type: [String], default: undefined },
    scroll: { type: Boolean, default: false },
    vitals: { type: Boolean, default: false },
    rules: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          type: { type: String, required: true },
          selector: { type: String, required: true },
          label: { type: String, required: true },
          // Pages the rule works on, like /product/*. Empty for every page.
          path: { type: String, default: '' },
        },
      ],
      default: [],
    },
    // The id of the Ackee event that holds each kind, see constants/tracking.js
    events: { type: Map, of: String, default: {} },
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
