import getBrowsers from '../database/browsers.js'
import getCountries from '../database/countries.js'
import getDevices from '../database/devices.js'
import getDurations from '../database/durations.js'
import getLanguages from '../database/languages.js'
import getPages from '../database/pages.js'
import getReferrers from '../database/referrers.js'
import getSizes from '../database/sizes.js'
import getSystems from '../database/systems.js'
import getViews from '../database/views.js'
import requireAuth from '../middlewares/requireAuth.js'
import domainIds from '../utils/domainIds.js'
import pipe from '../utils/pipe.js'
import recursiveId from '../utils/recursiveId.js'
import selectedDomain from '../utils/selectedDomain.js'
import KnownError from '../utils/KnownError.js'
import { createScope } from '../utils/scope.js'
import { DEVICES_TYPE_WITH_MODEL } from '../constants/devices.js'
import { SOURCE_GA4 } from '../constants/ga4.js'
import { SYSTEMS_TYPE_WITH_VERSION } from '../constants/systems.js'
import * as ga4 from '../database/ga4.js'

// The same reports from the days synced from GA4 (ACKEE-21). Same arguments, same shape.
const fromGa4 = {
  views: ga4.views,
  pages: (ids, sorting, range, limit, dateDetails) =>
    ga4.list('pages', ga4.pageUrl)(ids, sorting, undefined, range, limit, dateDetails),
  referrers: ga4.list('referrers'),
  durations: ga4.durations,
  systems: (ids, sorting, type, ...rest) =>
    ga4.list(type === SYSTEMS_TYPE_WITH_VERSION ? 'systemsWithVersion' : 'systems')(ids, sorting, type, ...rest),
  devices: (ids, sorting, type, ...rest) =>
    ga4.list(type === DEVICES_TYPE_WITH_MODEL ? 'devicesWithModel' : 'devices')(ids, sorting, type, ...rest),
  // GA4 has no browser versions in its reports, so both types show the browser
  browsers: ga4.list('browsers'),
  sizes: ga4.list('sizes'),
  languages: (ids, sorting, range, limit, dateDetails) =>
    ga4.list('languages')(ids, sorting, undefined, range, limit, dateDetails),
  countries: (ids, sorting, range, limit, dateDetails) =>
    ga4.list('countries')(ids, sorting, undefined, range, limit, dateDetails),
}

const pick = (domain, own, name) => (domain.source === SOURCE_GA4 ? fromGa4[name] : own)

// The date details narrowed by the filters and the period (ACKEE-24). GA4 keeps days of whole
// properties, so it has nothing to filter.
export const scopeOf = (domain, dateDetails) => {
  const scope = createScope(dateDetails, domain)
  if (scope !== dateDetails && domain.source === SOURCE_GA4) {
    throw new KnownError('Filters and periods are only available for the views collected by Ackee')
  }
  return scope
}

// Entries of another scope get ids of their own, so the cache of the interface keeps them apart
export const scopedIds = (scope) => (entries) =>
  scope.key == null ? entries : entries.map((entry) => ({ ...entry, id: recursiveId([entry.id, scope.key]) }))

export default {
  DomainStatistics: {
    id: pipe(requireAuth, async (domain, args, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)

      // Provide a static fallback id when there're no domains to create a recursive id from
      if (ids.length === 0) return 'eaf55ae8-29b8-448f-b45c-85e17fbfc8ba'

      // The interface caches by id, so Ackee's and GA4's numbers of the same domains must not share
      // one, and neither do the numbers of another filter or period
      const scope = scopeOf(domain, dateDetails)
      return recursiveId([
        ...(scope.key == null ? [] : [scope.key]),
        ...(domain.source === SOURCE_GA4 ? ['GA4', ...ids] : ids),
      ])
    }),
    views: pipe(requireAuth, async (domain, { type, interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getViews, 'views')(ids, type, interval, limit, scope))
    }),
    pages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getPages, 'pages')(ids, sorting, range, limit, scope))
    }),
    referrers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getReferrers, 'referrers')(ids, sorting, type, range, limit, scope))
    }),
    durations: pipe(requireAuth, async (domain, { interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getDurations, 'durations')(ids, interval, limit, scope))
    }),
    systems: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getSystems, 'systems')(ids, sorting, type, range, limit, scope))
    }),
    devices: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getDevices, 'devices')(ids, sorting, type, range, limit, scope))
    }),
    browsers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getBrowsers, 'browsers')(ids, sorting, type, range, limit, scope))
    }),
    sizes: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getSizes, 'sizes')(ids, sorting, type, range, limit, scope))
    }),
    languages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getLanguages, 'languages')(ids, sorting, range, limit, scope))
    }),
    countries: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const scope = scopeOf(domain, dateDetails)
      return scopedIds(scope)(await pick(domain, getCountries, 'countries')(ids, sorting, range, limit, scope))
    }),
  },
  Query: {
    // The dashboard picks a domain (ACKEE-81) and a source (ACKEE-21) independently
    statistics: async (parent, args, context) => ({
      ...(await selectedDomain(parent, args, context)),
      source: args.source,
      filters: args.filters,
      period: args.period,
    }),
  },
}
