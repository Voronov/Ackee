import { createRequire } from 'node:module'

import maxmind from 'maxmind'

import config from './config.js'

/*
 * The country of a visitor, from the address the request came from (ACKEE-100).
 *
 * The lookup is local: a database file from npm, read once into memory. No address ever
 * leaves the process, and only the two-letter code is kept with the view. Off unless
 * ACKEE_GEO=country, and then only for the domains whose owner turned it on.
 */

// CC0, so no attribution is owed. ACKEE_GEO_DATABASE points to another .mmdb, such as GeoLite2.
const DEFAULT_DATABASE = '@ip-location-db/geo-whois-asn-country-mmdb/geo-whois-asn-country.mmdb'

export const isEnabled = () => config.geo === 'country'

let reader

const open = async () => {
  if (reader == null) {
    const path = config.geoDatabase ?? createRequire(import.meta.url).resolve(DEFAULT_DATABASE)
    reader = await maxmind.open(path)
  }

  return reader
}

// Lets a test point at another database after the first lookup
export const reset = () => {
  reader = undefined
}

// A proxy hands over IPv4 as "::ffff:1.2.3.4" at times, which the database has no entry for
const plain = (ip) => String(ip).replace(/^::ffff:/i, '')

// The ISO 3166-1 alpha-2 code, or null for a private, unknown or malformed address.
export const countryOf = async (ip) => {
  if (isEnabled() === false || ip == null || ip === '') return null

  try {
    const code = (await open()).get(plain(ip))?.country_code

    return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null
  } catch {
    return null
  }
}
