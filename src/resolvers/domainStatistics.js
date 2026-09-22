import getBrowsers from '../database/browsers.js'
import getDevices from '../database/devices.js'
import getDurations from '../database/durations.js'
import getCountries from '../database/countries.js'
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

export default {
  DomainStatistics: {
    id: pipe(requireAuth, async (domain, args, { viewer }) => {
      const ids = await domainIds(domain, viewer)

      // Provide a static fallback id when there're no domains to create a recursive id from
      if (ids.length === 0) return 'eaf55ae8-29b8-448f-b45c-85e17fbfc8ba'

      return recursiveId(ids)
    }),
    views: pipe(requireAuth, async (domain, { type, interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getViews(ids, type, interval, limit, dateDetails)
    }),
    pages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getPages(ids, sorting, range, limit, dateDetails)
    }),
    referrers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getReferrers(ids, sorting, type, range, limit, dateDetails)
    }),
    durations: pipe(requireAuth, async (domain, { interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getDurations(ids, interval, limit, dateDetails)
    }),
    systems: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getSystems(ids, sorting, type, range, limit, dateDetails)
    }),
    devices: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getDevices(ids, sorting, type, range, limit, dateDetails)
    }),
    browsers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getBrowsers(ids, sorting, type, range, limit, dateDetails)
    }),
    sizes: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getSizes(ids, sorting, type, range, limit, dateDetails)
    }),
    languages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getLanguages(ids, sorting, range, limit, dateDetails)
    }),
    countries: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getCountries(ids, sorting, range, limit, dateDetails)
    }),
  },
  Query: {
    statistics: () => ({}),
  },
}
