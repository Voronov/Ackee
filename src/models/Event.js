import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { DEFAULT_WORKSPACE_ID } from '../constants/workspaces.js'

import {
  EVENTS_TYPE_AVERAGE_CHART,
  EVENTS_TYPE_AVERAGE_LIST,
  EVENTS_TYPE_TOTAL_CHART,
  EVENTS_TYPE_TOTAL_LIST,
} from '../constants/events.js'

const isKnownType = (value) =>
  [EVENTS_TYPE_TOTAL_CHART, EVENTS_TYPE_AVERAGE_CHART, EVENTS_TYPE_TOTAL_LIST, EVENTS_TYPE_AVERAGE_LIST].includes(value)

const schema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: uuid,
  },
  // An event belongs to a workspace, like a domain. Without this every account on the
  // instance would see every other account's events. Events from before workspaces are in
  // the default one, as domains are.
  workspaceId: {
    type: String,
    required: true,
    default: DEFAULT_WORKSPACE_ID,
  },
  title: {
    type: String,
    required: true,
    maxlength: 500,
  },
  type: {
    type: String,
    required: true,
    validate: isKnownType,
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

// Every event query is limited to the viewer's workspaces, so this is the main path.
schema.index({ workspaceId: 1 })

export default mongoose.model('Event', schema)
