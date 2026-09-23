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

// Id, created and updated are only set by the ingestion worker, which replays what the
// API already answered to the tracker; undefined leaves the schema defaults in charge
const fields = (data) => ({
  id: data.id,
  created: data.created,
  updated: data.updated,
  clientId: data.clientId,
  domainId: data.domainId,
  siteLocation: data.siteLocation,
  siteReferrer: data.siteReferrer,
  siteLanguage: data.siteLanguage,
  // Resolved from the IP on the server; the tracker never sends it.
  country: data.country,
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
})

export const add = async (data) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  return enhance(await Record.create(fields(data)))
}

// Runs the schema validation without saving, for callers that persist later. The ingest
// queue needs it: an event is rejected while the tracker is still waiting, not inside a
// worker that has nobody left to answer.
export const validate = async (data) => {
  const entry = new Record(fields(data))

  await entry.validate()

  return response(entry)
}

// $max instead of $set: the ingestion worker may replay an older touch after a newer
// one, and a visit must not get shorter
export const update = async (id, updated = Date.now()) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  const entry = await Record.findOneAndUpdate(
    {
      id,
    },
    {
      $max: {
        updated,
      },
    },
    {
      returnDocument: 'after',
    },
  )

  return enhance(entry)
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

export const anonymize = (clientId, ignoreId) => {
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
      ],
    },
    anonymized,
  )
}

// Same update as anonymize, but for records a caller has already read: a store that
// mirrors them elsewhere must null exactly the set it mirrored, not whatever matches
// the clientId by the time the update runs
export const anonymizeByIds = (ids) => {
  return Record.updateMany({ id: { $in: ids } }, anonymized)
}

export const del = (domainId) => {
  return Record.deleteMany({
    domainId,
  })
}
