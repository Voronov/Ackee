import { insert as insertIntoClickhouse, touch as touchInClickhouse } from '../clickhouse/records.js'
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

export const add = async (data) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  const entry = await Record.create({
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

  // Dual-write: MongoDB stays the source of truth while ClickHouse fills up alongside.
  // A columnar failure must not reject the event, so the insert never throws.
  await insertIntoClickhouse(entry)

  return enhance(entry)
}

export const update = async (id) => {
  const enhance = (entry) => {
    return entry == null ? entry : response(entry)
  }

  const entry = await Record.findOneAndUpdate(
    {
      id,
    },
    {
      $set: {
        updated: Date.now(),
      },
    },
    {
      returnDocument: 'after',
    },
  )

  // Extending a visit in the columnar store means inserting the row again with a newer
  // `updated`. ReplacingMergeTree keeps the last one on merge.
  await touchInClickhouse(entry)

  return enhance(entry)
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
    {
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
    },
  )
}

export const del = (domainId) => {
  return Record.deleteMany({
    domainId,
  })
}
