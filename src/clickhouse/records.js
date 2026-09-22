import { getClient, isEnabled } from '../utils/clickhouse.js'
import signale from '../utils/signale.js'

// DateTime64(3) expects `2026-09-22 09:30:00.000`. The column is declared in UTC, so
// that is what goes in.
const toDateTime = (value) => new Date(value).toISOString().replace('T', ' ').replace('Z', '')

// Only the fields that exist in the columnar schema are copied. `clientId` is left out
// on purpose, see the schema comment.
const toRow = (entry) => ({
  id: entry.id,
  domainId: entry.domainId,
  siteLocation: entry.siteLocation,
  siteReferrer: entry.siteReferrer ?? null,
  source: entry.source ?? null,
  siteLanguage: entry.siteLanguage ?? null,
  country: entry.country ?? null,
  screenWidth: entry.screenWidth ?? null,
  screenHeight: entry.screenHeight ?? null,
  screenColorDepth: entry.screenColorDepth ?? null,
  deviceName: entry.deviceName ?? null,
  deviceManufacturer: entry.deviceManufacturer ?? null,
  osName: entry.osName ?? null,
  osVersion: entry.osVersion ?? null,
  browserName: entry.browserName ?? null,
  browserVersion: entry.browserVersion ?? null,
  browserWidth: entry.browserWidth ?? null,
  browserHeight: entry.browserHeight ?? null,
  created: toDateTime(entry.created),
  updated: toDateTime(entry.updated),
})

/*
 * Writes a record to the columnar store as well.
 *
 * A failure here does not reject the event: MongoDB stays the source of truth until reads
 * are switched over, and a lost row is recovered by `clickhouse:backfill`.
 */
export const insert = async (entries) => {
  if (isEnabled() === false) return

  const values = (Array.isArray(entries) ? entries : [entries]).filter(Boolean).map((entry) => toRow(entry))

  if (values.length === 0) return

  try {
    await getClient().insert({ table: 'records', values, format: 'JSONEachRow' })
  } catch (error) {
    signale.fatal(`ClickHouse insert failed: ${error.message}`)
  }
}

// A visit is extended by a separate request. ReplacingMergeTree keeps the newest row on
// merge, so inserting again is the update.
export const touch = insert
