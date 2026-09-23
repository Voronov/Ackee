import isUrl from 'is-url'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

const isNullOrUrl = (value) => value == null || isUrl(value)

const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  clientId: {
    type: String,
    index: true,
  },
  domainId: {
    type: String,
    required: true,
  },
  siteLocation: {
    type: String,
    required: true,
    validate: isUrl,
  },
  siteReferrer: {
    type: String,
    validate: isNullOrUrl,
  },
  siteLanguage: {
    type: String,
    minlength: 2,
    maxlength: 2,
  },
  // ISO 3166-1 alpha-2, resolved from the IP on the server. The address itself is used
  // for the lookup and then dropped; it is never stored.
  country: {
    type: String,
    minlength: 2,
    maxlength: 2,
  },
  source: {
    type: String,
    maxlength: 500,
  },
  screenWidth: {
    type: Number,
    min: 0,
    max: 100000,
  },
  screenHeight: {
    type: Number,
    min: 0,
    max: 100000,
  },
  screenColorDepth: {
    type: Number,
    min: 1,
    max: 48,
  },
  deviceName: {
    type: String,
    maxlength: 200,
  },
  deviceManufacturer: {
    type: String,
    maxlength: 200,
  },
  osName: {
    type: String,
    maxlength: 200,
  },
  osVersion: {
    type: String,
    maxlength: 100,
  },
  browserName: {
    type: String,
    maxlength: 200,
  },
  browserVersion: {
    type: String,
    maxlength: 100,
  },
  browserWidth: {
    type: Number,
    min: 0,
    max: 100000,
  },
  browserHeight: {
    type: Number,
    min: 0,
    max: 100000,
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

// Every report starts with `{ domainId: { $in: ids }, created: { $gte: … } }`, see
// stages/matchDomains.js. A single index on `created` made the planner read millions of
// documents; one on `domainId` made it read a domain's whole history. The compound index
// covers both conditions at once.
//
// The standalone `domainId` index is gone: it is a prefix of this one, so it served the
// same queries while costing writes and storage.
schema.index({ domainId: 1, created: 1 })

export default mongoose.model('Record', schema)
