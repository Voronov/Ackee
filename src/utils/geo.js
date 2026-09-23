import { Reader } from 'mmdb-lib'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import config from './config.js'
import signale from './signale.js'

// The country is resolved from a local database, not an external service. Calling a
// third-party API would mean handing them every visitor's IP, which is the opposite of
// what the daily salt elsewhere in Ackee is for.
//
// The data is geo-whois-asn-country from ip-location-db: CC0, updated with the dependency,
// no account needed.
const DATABASE = '@ip-location-db/geo-whois-asn-country-mmdb/geo-whois-asn-country.mmdb'

let reader = null
let loading = null

const load = async () => {
  const require = createRequire(import.meta.url)

  try {
    const buffer = await readFile(require.resolve(DATABASE))
    reader = new Reader(buffer)
    signale.info('Geolocation database loaded')
  } catch (error) {
    // Without the database, geolocation simply turns off. A missing country is no reason
    // to reject an event.
    signale.warn(`Geolocation disabled: ${error.message}`)
    reader = false
  }
}

export const ready = () => {
  if (config.geo !== true) return Promise.resolve()

  loading ??= load()

  return loading
}

// The ISO 3166-1 alpha-2 country for an IP, or `null`. The address itself is never stored
// and never leaves this function.
export default (ip) => {
  if (config.geo !== true || reader == null || reader === false || ip == null) return null

  try {
    const record = reader.get(ip)

    // Two record shapes: `country_code` in ip-location-db files and a nested
    // `country.iso_code` in MaxMind ones. Supporting both lets the database be swapped.
    const country = record?.country_code ?? record?.country?.iso_code

    return typeof country === 'string' && country.length === 2 ? country : null
  } catch {
    return null
  }
}
