import { BetaAnalyticsDataClient } from '@google-analytics/data'

import { expandRow } from './ga4.js'

/*
 * Reads a Google Analytics 4 property through the Data API.
 *
 * The rows come back in the same shape the CSV importer already understands, so both paths
 * share one mapper and one set of decisions about what a row becomes. Only the source
 * differs: a file someone exported by hand, or a daily pull.
 */

// The order here is the order of the values below. It doubles as the column mapping the
// CSV importer uses, which is why both can share `expandRow`.
const DIMENSIONS = ['date', 'pagePath', 'country', 'sessionSource', 'browser', 'operatingSystem', 'deviceCategory']

const MAPPING = {
  date: 0,
  path: 1,
  country: 2,
  referrer: 3,
  browser: 4,
  os: 5,
  device: 6,
  views: 7,
}

export const clientFor = (credentials) =>
  new BetaAnalyticsDataClient({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    projectId: credentials.project_id,
  })

// Checks that the key works and the property is readable, before anything is stored.
export const check = async (credentials, propertyId) => {
  const client = clientFor(credentials)

  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
    metrics: [{ name: 'screenPageViews' }],
    limit: 1,
  })

  return { rows: Number(response.rowCount ?? 0) }
}

const asDate = (value) => value.toISOString().slice(0, 10)

/*
 * Pulls one day and turns it into records.
 *
 * A day at a time rather than a range, because a failed run then repeats one day instead
 * of losing or duplicating a stretch of history. The API caps a response at 100 000 rows,
 * so the request pages until it runs out.
 */
export const fetchDay = async ({ credentials, propertyId, date, domainId, origin }) => {
  const client = clientFor(credentials)
  const day = asDate(date)
  const records = []
  let offset = 0

  for (;;) {
    const [response] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: day, endDate: day }],
      dimensions: DIMENSIONS.map((name) => ({ name })),
      metrics: [{ name: 'screenPageViews' }],
      limit: 100_000,
      offset,
    })

    const rows = response.rows ?? []

    for (const row of rows) {
      const values = [...row.dimensionValues.map((value) => value.value), row.metricValues[0].value]

      records.push(...expandRow({ values, mapping: MAPPING, domainId, origin }))
    }

    offset += rows.length

    if (rows.length === 0 || offset >= Number(response.rowCount ?? 0)) break
  }

  return records
}
