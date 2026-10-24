import { createHash } from 'node:crypto'

import Record from '../models/Record.js'

const response = (entry) => ({
  id: entry.id,
  siteLocation: entry.siteLocation,
  siteReferrer: entry.siteReferrer,
  siteLanguage: entry.siteLanguage,
  source: entry.source,
  screenWidth: entry.screenWidth,
  screenHeight: entry.screenHeight,
  screenColorDepth: entry.screenColorDepth,
  deviceName: entry.deviceName,
  deviceManufacturer: entry.deviceManufacturer,
  osName: entry.osName,
  osVersion: entry.osVersion,
  browserName: entry.browserName,
  browserVersion: entry.browserVersion,
  browserWidth: entry.browserWidth,
  browserHeight: entry.browserHeight,
  created: entry.created,
  updated: entry.updated,
})

// What a record is stored with. Without the queue the id and the dates are left to the model
// defaults; through the queue they come from the message, so a redelivery stores the same record.
const fields = (data) => ({
  id: data.id,
  clientId: data.clientId,
  domainId: data.domainId,
  siteLocation: data.siteLocation,
  siteReferrer: data.siteReferrer,
  siteLanguage: data.siteLanguage,
  source: data.source,
  screenWidth: data.screenWidth,
  screenHeight: data.screenHeight,
  screenColorDepth: data.screenColorDepth,
  deviceName: data.deviceName,
  deviceManufacturer: data.deviceManufacturer,
  osName: data.osName,
  osVersion: data.osVersion,
  browserName: data.browserName,
  browserVersion: data.browserVersion,
  browserWidth: data.browserWidth,
  browserHeight: data.browserHeight,
  created: data.created,
  updated: data.updated,
})

export const add = async (data) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Record.create(fields(data)))
}

// Runs the checks of add() without MongoDB, so the API can answer the tracker before the
// record is stored. Rejects with the same ValidationError add() would.
export const validate = async (data) => {
  const entry = new Record(fields(data))
  await entry.validate()

  return response(entry)
}

// $max, not $set: a redelivered or late touch must not move updated back in time
export const update = async (id, updated = Date.now()) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(
    await Record.findOneAndUpdate(
      {
        id,
      },
      {
        $max: {
          updated: new Date(updated),
        },
      },
      {
        returnDocument: 'after',
      },
    ),
  )
}

const anonymized = {
  clientId: null,
  siteLanguage: null,
  screenWidth: null,
  screenHeight: null,
  screenColorDepth: null,
  deviceName: null,
  deviceManufacturer: null,
  osName: null,
  osVersion: null,
  browserName: null,
  browserVersion: null,
  browserWidth: null,
  browserHeight: null,
}

// The queue passes the time of the event as `before`: a redelivered view may arrive after a
// newer one of the same visitor, and only the records not newer than it are its to forget.
// A view of the same millisecond counts as older, so one record keeps the visitor either way.
export const anonymize = (clientId, ignoreId, before) => {
  // Don't return anything about the update
  return Record.updateMany(
    {
      $and: [
        { clientId },
        {
          id: {
            $ne: ignoreId,
          },
        },
        ...(before == null ? [] : [{ created: { $lte: new Date(before) } }]),
      ],
    },
    anonymized,
  )
}

// Whether the visitor has a record newer than the given one, so the given one is the one to forget
export const hasNewer = async (clientId, id, created) => {
  return (await Record.exists({ clientId, id: { $ne: id }, created: { $gt: new Date(created) } })) != null
}

export const anonymizeOne = (id) => {
  return Record.updateOne({ id }, anonymized)
}

// What the live feed may show of a view (ADR-007): fields of the reports only, never the
// clientId, versions or sizes. The key stands in for the id, because the id is what updateRecord takes.
const LIVE_FIELDS = [
  'domainId',
  'siteLocation',
  'siteReferrer',
  'source',
  'siteLanguage',
  'browserName',
  'osName',
  'deviceManufacturer',
  'deviceName',
  'created',
]

const liveKey = (id) => createHash('sha256').update(id).digest('base64url').slice(0, 16)

const liveResponse = (entry) => ({
  key: liveKey(entry.id),
  ...Object.fromEntries(LIVE_FIELDS.map((field) => [field, entry[field] ?? null])),
})

// Newest first, so the limit drops what is already old rather than what just came in. Served
// by the compound index of models/Record.js, read backwards (explain test in test/models/indexes.js).
export const liveQuery = (domainIds, since, limit) => {
  return Record.find({ domainId: { $in: domainIds }, created: { $gt: since } })
    .select(['id', ...LIVE_FIELDS])
    .sort({ created: -1 })
    .limit(limit)
    .lean()
}

// Views of the given domains created after `since`, newest first. The caller has checked access.
export const live = async (domainIds, since, limit) => {
  return (await liveQuery(domainIds, since, limit)).map(liveResponse)
}

export const del = (domainId) => {
  return Record.deleteMany({
    domainId,
  })
}
