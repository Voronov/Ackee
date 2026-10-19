// Every dimension that gets rolled up: the full list of field sets the data layer passes
// to aggregateTopRecords.
//
// It is a separate list on purpose. A rollup has to exist before the request arrives, so
// the list cannot be derived from the requests themselves.
export const VIEWS = '__views'
export const UNIQUE_VIEWS = '__uniqueViews'
export const DURATIONS = '__durations'

export default [
  // Views: no grouping fields, every record in the bucket is counted. Unique views are
  // excluded, because distinct client counts cannot be summed across buckets.
  { name: VIEWS, properties: [] },
  // Spike ACKEE-15. Unique views are records that still carry a clientId. That count sums
  // across buckets, but only for days that are over, see `sealed` in RollupState.
  { name: UNIQUE_VIEWS, properties: [], match: { clientId: { $ne: null } } },
  // Spike ACKEE-15. Durations keep a sum next to the count, see `sum` in Rollup.
  { name: DURATIONS, properties: [], durations: true },
  { properties: ['siteLocation'] }, // Pages
  { properties: ['source', 'siteReferrer'], or: true }, // Referrers WITH_SOURCE
  { properties: ['siteReferrer'] }, // Referrers NO_SOURCE
  { properties: ['source'] }, // Referrers ONLY_SOURCE
  { properties: ['osName'] }, // Systems NO_VERSION
  { properties: ['osName', 'osVersion'] }, // Systems WITH_VERSION
  { properties: ['deviceManufacturer'] }, // Devices NO_MODEL
  { properties: ['deviceManufacturer', 'deviceName'] }, // Devices WITH_MODEL
  { properties: ['browserName'] }, // Browsers NO_VERSION
  { properties: ['browserName', 'browserVersion'] }, // Browsers WITH_VERSION
  { properties: ['browserWidth'] }, // Sizes BROWSER_WIDTH
  { properties: ['browserHeight'] }, // Sizes BROWSER_HEIGHT
  { properties: ['browserWidth', 'browserHeight'] }, // Sizes BROWSER_RESOLUTION
  { properties: ['screenWidth'] }, // Sizes SCREEN_WIDTH
  { properties: ['screenHeight'] }, // Sizes SCREEN_HEIGHT
  { properties: ['screenWidth', 'screenHeight'] }, // Sizes SCREEN_RESOLUTION
  { properties: ['siteLanguage'] }, // Languages
  { properties: ['country'] }, // Countries
]
