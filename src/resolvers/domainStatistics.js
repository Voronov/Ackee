import { getEventStore } from '../stores/index.js'
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
      return getEventStore().views(ids, type, interval, limit, dateDetails)
    }),
    pages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().pages(ids, sorting, range, limit, dateDetails)
    }),
    referrers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().referrers(ids, sorting, type, range, limit, dateDetails)
    }),
    durations: pipe(requireAuth, async (domain, { interval, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().durations(ids, interval, limit, dateDetails)
    }),
    systems: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().systems(ids, sorting, type, range, limit, dateDetails)
    }),
    devices: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().devices(ids, sorting, type, range, limit, dateDetails)
    }),
    browsers: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().browsers(ids, sorting, type, range, limit, dateDetails)
    }),
    sizes: pipe(requireAuth, async (domain, { sorting, type, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().sizes(ids, sorting, type, range, limit, dateDetails)
    }),
    languages: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().languages(ids, sorting, range, limit, dateDetails)
    }),
    countries: pipe(requireAuth, async (domain, { sorting, range, limit }, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      return getEventStore().countries(ids, sorting, range, limit, dateDetails)
    }),
  },
  Query: {
    statistics: () => ({}),
  },
}
