// Google Analytics 4 next to Ackee's own records (ACKEE-21). The reports read either source.
export const SOURCE_ACKEE = 'ACKEE'
export const SOURCE_GA4 = 'GA4'

// Which GA4 dimension answers which Ackee list. Synced once a day per dimension; nothing that
// identifies a person is asked for.
export const GA4_DIMENSIONS = {
  pages: 'fullPageUrl',
  referrers: 'sessionSource',
  systems: 'operatingSystem',
  systemsWithVersion: 'operatingSystemWithVersion',
  devices: 'mobileDeviceBranding',
  devicesWithModel: 'mobileDeviceModel',
  browsers: 'browser',
  sizes: 'screenResolution',
  languages: 'language',
}

// The first sync reaches back this far. GA4 keeps standard reports longer, but a first sync of
// years would run for hours.
export const GA4_BACKFILL_DAYS = 425

// GA4 finishes counting a day up to three days later, so every sync reads those again.
export const GA4_REFRESH_DAYS = 3

// Days per request while backfilling, so one response stays well below the API's row limit
export const GA4_CHUNK_DAYS = 90

export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

// A GA4 property id is a number, shown under Admin → Property details
export const GA4_PROPERTY_ID = /^\d{5,15}$/
