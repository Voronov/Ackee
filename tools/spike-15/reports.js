import { INTERVALS_DAILY } from '../../src/constants/intervals.js'
import { RANGES_LAST_30_DAYS } from '../../src/constants/ranges.js'
import { REFERRERS_TYPE_WITH_SOURCE } from '../../src/constants/referrers.js'
import { SORTINGS_TOP } from '../../src/constants/sortings.js'
import { VIEWS_TYPE_TOTAL, VIEWS_TYPE_UNIQUE } from '../../src/constants/views.js'
import durationsFromMongo from '../../src/database/durations.js'
import referrersFromMongo from '../../src/database/referrers.js'
import viewsFromMongo from '../../src/database/views.js'
import * as rollups from '../../src/rollups/read.js'
import * as clickhouse from '../../src/stores/clickhouse/index.js'
import * as variantC from './variantC.js'

// The four 30-day reports of ACKEE-15, as scripts/measure-reports.js in develop asks for
// them: views DAILY UNIQUE and TOTAL with limit 30, referrers TOP WITH_SOURCE
// LAST_30_DAYS with the default limit 30, durations DAILY with limit 30.
const LIMIT = 30

const sum = (entries) => entries.reduce((total, entry) => total + entry.count, 0)

// Days without records report 0, which is no duration at all
const averageOfDays = (entries) => {
  const days = entries.filter((entry) => entry.count > 0)
  return days.length === 0 ? 0 : sum(days) / days.length
}

// Rollups are read only when ACKEE_ROLLUPS is on, and config reads the environment on
// every access, so switching it right before a call is enough.
const withRollups = (enabled, fn) => (ids, dateDetails) => {
  process.env.ACKEE_ROLLUPS = String(enabled)
  process.env.ACKEE_ROLLUPS_UNIQUE = String(enabled)
  process.env.ACKEE_ROLLUPS_DURATIONS = String(enabled)

  return fn(ids, dateDetails)
}

// Variant A falls back to raw records without a word when the rollups do not cover the
// window. A comparison would then show raw against raw, so A has to prove it read rollups.
const fromRollupsOnly = (probe, fn) =>
  withRollups(true, async (ids, dateDetails) => {
    if ((await probe(ids, dateDetails)) == null) throw new Error('rollups did not answer, the range is not covered')
    return fn(ids, dateDetails)
  })

const viewsReport = (type, probe) => ({
  kind: 'interval',
  raw: withRollups(false, (ids, dateDetails) => viewsFromMongo(ids, type, INTERVALS_DAILY, LIMIT, dateDetails)),
  a: fromRollupsOnly(
    (ids, dateDetails) => probe(ids, INTERVALS_DAILY, LIMIT, dateDetails),
    (ids, dateDetails) => viewsFromMongo(ids, type, INTERVALS_DAILY, LIMIT, dateDetails),
  ),
  b: (ids, dateDetails) => clickhouse.views(ids, type, INTERVALS_DAILY, LIMIT, dateDetails),
  c: (ids, dateDetails) => variantC.views(ids, type, INTERVALS_DAILY, LIMIT, dateDetails),
  describe: (entries) => `${sum(entries)} views`,
})

const referrersFrom = (fn) => (ids, dateDetails) =>
  fn(ids, SORTINGS_TOP, REFERRERS_TYPE_WITH_SOURCE, RANGES_LAST_30_DAYS, LIMIT, dateDetails)

export const reports = {
  'views-unique': { name: 'views DAILY UNIQUE', ...viewsReport(VIEWS_TYPE_UNIQUE, rollups.uniqueViews) },
  'views-total': { name: 'views DAILY TOTAL', ...viewsReport(VIEWS_TYPE_TOTAL, rollups.views) },
  'referrers': {
    name: 'referrers TOP LAST_30_DAYS',
    kind: 'top',
    raw: withRollups(false, referrersFrom(referrersFromMongo)),
    a: fromRollupsOnly(
      (ids, dateDetails) =>
        rollups.topRecords(ids, ['source', 'siteReferrer'], RANGES_LAST_30_DAYS, LIMIT, dateDetails, true),
      referrersFrom(referrersFromMongo),
    ),
    b: referrersFrom(clickhouse.referrers),
    c: (ids, dateDetails) => variantC.referrers(ids, LIMIT, dateDetails),
    describe: (entries) => `${entries.length} referrers`,
  },
  'durations': {
    name: 'durations DAILY',
    kind: 'interval',
    raw: withRollups(false, (ids, dateDetails) => durationsFromMongo(ids, INTERVALS_DAILY, LIMIT, dateDetails)),
    a: fromRollupsOnly(
      (ids, dateDetails) => rollups.durations(ids, INTERVALS_DAILY, LIMIT, dateDetails),
      (ids, dateDetails) => durationsFromMongo(ids, INTERVALS_DAILY, LIMIT, dateDetails),
    ),
    b: (ids, dateDetails) => clickhouse.durations(ids, INTERVALS_DAILY, LIMIT, dateDetails),
    // No view for durations in C, see variantC.js
    c: (ids, dateDetails) => clickhouse.durations(ids, INTERVALS_DAILY, LIMIT, dateDetails),
    describe: (entries) => `${Math.round(averageOfDays(entries) / 1000)} s average`,
  },
}

export const reportKeys = Object.keys(reports)
