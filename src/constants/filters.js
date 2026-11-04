// The fields of a record a report can be filtered by (ACKEE-24), by their name in the API
export const FILTER_FIELDS = {
  SITE_LOCATION: 'siteLocation',
  SITE_REFERRER: 'siteReferrer',
  SOURCE: 'source',
  COUNTRY: 'country',
  BROWSER_NAME: 'browserName',
  BROWSER_VERSION: 'browserVersion',
  OS_NAME: 'osName',
  OS_VERSION: 'osVersion',
  DEVICE_MANUFACTURER: 'deviceManufacturer',
  DEVICE_NAME: 'deviceName',
}

// The other way round, to hand the fields of an entry back as a filter
export const FILTER_NAMES = Object.fromEntries(Object.entries(FILTER_FIELDS).map(([name, field]) => [field, name]))

export const FILTERS_MAX = 10
export const FILTER_VALUE_MAX_LENGTH = 2000

// About ten years of days, so a chart of a period stays a sane size
export const PERIOD_MAX_DAYS = 3660
