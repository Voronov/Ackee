import getBrowsers from '../database/browsers.js'
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
}

const pick = (domain, own, name) => (domain.source === SOURCE_GA4 ? fromGa4[name] : own)

export default {
  DomainStatistics: {
    id: pipe(requireAuth, async (domain, args, { viewer }) => {
      const ids = await domainIds(domain, viewer)

      // Provide a static fallback id when there're no domains to create a recursive id from
      if (ids.length === 0) return 'eaf55ae8-29b8-448f-b45c-85e17fbfc8ba'

      // The interface caches by id, so Ackee's and GA4's numbers of the same domains must not share one
      return recursiveId(domain.source === SOURCE_GA4 ? ['GA4', ...ids] : ids)
    }),
    views: pipe(requireAuth, async (domain, { type, interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getViews, 'views')(ids, type, interval, limit, dateDetails)
    }),
    pages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getPages, 'pages')(ids, sorting, range, limit, dateDetails)
    }),
    referrers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getReferrers, 'referrers')(ids, sorting, type, range, limit, dateDetails)
    }),
    durations: pipe(requireAuth, async (domain, { interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getDurations, 'durations')(ids, interval, limit, dateDetails)
    }),
    systems: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getSystems, 'systems')(ids, sorting, type, range, limit, dateDetails)
    }),
    devices: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getDevices, 'devices')(ids, sorting, type, range, limit, dateDetails)
    }),
    browsers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getBrowsers, 'browsers')(ids, sorting, type, range, limit, dateDetails)
    }),
    sizes: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getSizes, 'sizes')(ids, sorting, type, range, limit, dateDetails)
    }),
    languages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return pick(domain, getLanguages, 'languages')(ids, sorting, range, limit, dateDetails)
    }),
  },
  Query: {
    statistics: (parent, { source }) => ({ source }),
  },
}
