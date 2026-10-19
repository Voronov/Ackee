// The fields every dimension report is rolled up by. A rollup keeps them all, so each type of
// the report groups the same documents by its own subset of fields (see database/dimension.js).
// A rollup has to exist before the request arrives, which is why this list is not derived
// from the requests.
export const ROLLUP_DIMENSIONS = {
  referrers: ['source', 'siteReferrer'],
  systems: ['osName', 'osVersion'],
  devices: ['deviceManufacturer', 'deviceName'],
  browsers: ['browserName', 'browserVersion'],
  sizes: ['browserWidth', 'browserHeight', 'screenWidth', 'screenHeight'],
}

// The days of the backfill are built one at a time, so a single aggregation stays small.
export const ROLLUP_CHUNK_HOURS = 24

// Two processes must not build the same hours. A crashed one gives up its lease after this.
export const ROLLUP_LEASE = 15 * 60 * 1000
