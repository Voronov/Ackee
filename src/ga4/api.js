import crypto from 'node:crypto'

import { GA4_SCOPE } from '../constants/ga4.js'
import config from '../utils/config.js'

/*
 * The GA4 Data API with a service account (ACKEE-21), without Google's client libraries: a
 * signed JWT buys an access token, and the token reads reports.
 */
const base64url = (value) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

// Tokens live an hour. Kept per service account, so a sync does not ask for one per report.
// Keyed by the key itself, not the address alone (review of #37): an address is public, and a
// token bought with someone's key must not serve a connection that only claims that address.
const tokens = new Map()

const keyOf = ({ clientEmail, privateKey }) =>
  crypto.createHash('sha256').update(`${clientEmail}\n${privateKey}`).digest('hex')

const accessToken = async ({ clientEmail, privateKey }, fresh = false) => {
  const id = keyOf({ clientEmail, privateKey })
  const cached = tokens.get(id)
  if (fresh === false && cached != null && cached.expires > Date.now() + 60_000) return cached.token

  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iss: clientEmail,
    scope: GA4_SCOPE,
    aud: config.ga4TokenUrl,
    iat: now,
    exp: now + 3600,
  })}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')

  const response = await fetch(config.ga4TokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })
  const json = await response.json().catch(() => ({}))
  if (response.ok === false)
    throw new Error(`Google refused the service account: ${json.error_description ?? json.error ?? response.status}`)

  tokens.set(id, { token: json.access_token, expires: Date.now() + json.expires_in * 1000 })

  return json.access_token
}

// Every row of a report, page by page. GA4 caps one answer at 100 000 rows. `fresh` buys a new
// token with the given key, whatever the cache holds.
export const runReport = async (account, propertyId, request, { fresh = false } = {}) => {
  const token = await accessToken(account, fresh)
  const rows = []
  const limit = 100_000

  for (let offset = 0; ; offset += limit) {
    const response = await fetch(`${config.ga4ApiUrl}/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ ...request, limit, offset }),
    })
    const json = await response.json().catch(() => ({}))

    if (response.ok === false) {
      // The message Google gives is the useful part, like "User does not have sufficient permissions"
      throw new Error(json.error?.message ?? `Google Analytics answered ${response.status}`)
    }

    // A report without dimensions has no dimensionValues on its row
    for (const row of json.rows ?? []) {
      rows.push({
        dimensions: (row.dimensionValues ?? []).map((value) => value.value),
        metrics: row.metricValues.map((value) => Number(value.value)),
      })
    }

    if (offset + limit >= (json.rowCount ?? 0)) return rows
  }
}
