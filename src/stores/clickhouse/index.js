import { randomUUID as uuid } from 'node:crypto'

import { getClient } from '../../clickhouse/client.js'
import { timeReport } from '../../utils/metrics.js'
import config from '../../utils/config.js'
import { chart, list } from './reports/actions.js'
import activeVisitorsReport from './reports/activeVisitors.js'
import browsersReport from './reports/browsers.js'
import countriesReport from './reports/countries.js'
import devicesReport from './reports/devices.js'
import durationsReport from './reports/durations.js'
import languagesReport from './reports/languages.js'
import pagesReport from './reports/pages.js'
import referrersReport from './reports/referrers.js'
import sizesReport from './reports/sizes.js'
import systemsReport from './reports/systems.js'
import viewsReport from './reports/views.js'
import { flush, push } from './writer.js'

/**
 * ClickHouse side of the event store. MongoDB stays the source of truth, so the write
 * functions take the state MongoDB already persisted instead of re-deriving it:
 * `addRecord`/`addAction` accept `id`, `created` and `updated` (generated when missing),
 * `touchRecord`/`touchAction` take the full record after the touch, `anonymize` takes
 * the records to anonymize as MongoDB saw them before its update. The reports have the
 * signatures and result shape of `src/database/*.js`, see `SEMANTICS.md`.
 */

const timed = (report, fn) => timeReport(report, 'clickhouse', fn)

export const views = timed('views', viewsReport)
export const pages = timed('pages', pagesReport)
export const referrers = timed('referrers', referrersReport)
export const durations = timed('durations', durationsReport)
export const systems = timed('systems', systemsReport)
export const devices = timed('devices', devicesReport)
export const browsers = timed('browsers', browsersReport)
export const sizes = timed('sizes', sizesReport)
export const languages = timed('languages', languagesReport)
export const countries = timed('countries', countriesReport)
export const activeVisitors = timed('activeVisitors', activeVisitorsReport)
export const actionsChart = timed('actionsChart', chart)
export const actionsList = timed('actionsList', list)

// Same fields src/database/records.js nulls, minus clientId which is '' in ClickHouse
const anonymizedFields = [
  'siteLanguage',
  'screenWidth',
  'screenHeight',
  'screenColorDepth',
  'deviceName',
  'deviceManufacturer',
  'osName',
  'osVersion',
  'browserName',
  'browserVersion',
  'browserWidth',
  'browserHeight',
]

let lastVersion = 0

// Two versions of the same row within one millisecond would be an arbitrary pick for
// ReplacingMergeTree, so versions are strictly increasing within the process
const nextVersion = () => {
  lastVersion = Math.max(Date.now(), lastVersion + 1)
  return lastVersion
}

const orNull = (value) => value ?? null

// A plain millisecond number would be read as seconds; ISO with a zone is unambiguous
const toDateTime = (value) => new Date(value).toISOString()

// The migration script passes its own version, see "Migrated history" in SEMANTICS.md
export const recordRow = (record, version = nextVersion()) => ({
  id: record.id,
  clientId: record.clientId ?? '',
  domainId: record.domainId,
  siteLocation: record.siteLocation,
  siteReferrer: orNull(record.siteReferrer),
  siteLanguage: orNull(record.siteLanguage),
  country: orNull(record.country),
  source: orNull(record.source),
  screenWidth: orNull(record.screenWidth),
  screenHeight: orNull(record.screenHeight),
  screenColorDepth: orNull(record.screenColorDepth),
  deviceName: orNull(record.deviceName),
  deviceManufacturer: orNull(record.deviceManufacturer),
  osName: orNull(record.osName),
  osVersion: orNull(record.osVersion),
  browserName: orNull(record.browserName),
  browserVersion: orNull(record.browserVersion),
  browserWidth: orNull(record.browserWidth),
  browserHeight: orNull(record.browserHeight),
  created: toDateTime(record.created),
  updated: toDateTime(record.updated),
  version,
})

export const actionRow = (action, version = nextVersion()) => ({
  id: action.id,
  eventId: action.eventId,
  key: orNull(action.key),
  value: orNull(action.value),
  details: orNull(action.details),
  created: toDateTime(action.created),
  updated: toDateTime(action.updated),
  version,
})

const withDefaults = (data) => {
  const now = new Date()
  return { id: uuid(), created: now, updated: now, ...data }
}

const recordResponse = (record) => ({
  id: record.id,
  siteLocation: record.siteLocation,
  siteReferrer: record.siteReferrer,
  siteLanguage: record.siteLanguage,
  source: record.source,
  screenWidth: record.screenWidth,
  screenHeight: record.screenHeight,
  screenColorDepth: record.screenColorDepth,
  deviceName: record.deviceName,
  deviceManufacturer: record.deviceManufacturer,
  osName: record.osName,
  osVersion: record.osVersion,
  browserName: record.browserName,
  browserVersion: record.browserVersion,
  browserWidth: record.browserWidth,
  browserHeight: record.browserHeight,
  created: record.created,
  updated: record.updated,
})

const actionResponse = (action) => ({
  id: action.id,
  key: action.key,
  value: action.value,
  details: action.details,
  created: action.created,
  updated: action.updated,
})

// Mutations run in the background; rows of the domain may linger for a moment
const deleteWhere = async (table, column, value) => {
  await flush()
  await getClient().command({
    query: `ALTER TABLE {database:Identifier}.{table:Identifier} DELETE WHERE {column:Identifier} = {value:String}`,
    query_params: { database: config.clickhouseDatabase, table, column, value },
  })
}

export const addRecord = (data) => {
  const record = withDefaults(data)
  push('records', recordRow(record))
  return recordResponse(record)
}

export const touchRecord = (record) => {
  push('records', recordRow(record))
  return recordResponse(record)
}

export const anonymize = (records) => {
  for (const record of records) {
    push('records', {
      ...recordRow(record),
      clientId: '',
      ...Object.fromEntries(anonymizedFields.map((field) => [field, null])),
    })
  }
}

export const deleteRecords = (domainId) => deleteWhere('records', 'domainId', domainId)

export const addAction = (data) => {
  const action = withDefaults(data)
  push('actions', actionRow(action))
  return actionResponse(action)
}

export const touchAction = (action) => {
  push('actions', actionRow(action))
  return actionResponse(action)
}

export const deleteActions = (eventId) => deleteWhere('actions', 'eventId', eventId)
