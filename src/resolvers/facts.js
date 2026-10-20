import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../constants/intervals.js'
import { VIEWS_TYPE_UNIQUE } from '../constants/views.js'
import getDurations from '../database/durations.js'
import getActiveVisitors from '../database/facts.js'
import getViews from '../database/views.js'
import requireAuth from '../middlewares/requireAuth.js'
import domainIds from '../utils/domainIds.js'
import pipe from '../utils/pipe.js'
import recursiveId from '../utils/recursiveId.js'
import { SOURCE_GA4 } from '../constants/ga4.js'
import * as ga4 from '../database/ga4.js'

// GA4 days instead of Ackee's records when the facts ask for them (ACKEE-21)
const viewsOf = (domain) => (domain.source === SOURCE_GA4 ? ga4.views : getViews)
const durationsOf = (domain) => (domain.source === SOURCE_GA4 ? ga4.durations : getDurations)

export default {
  AverageViews: {
    count: pipe(requireAuth, (entries) => {
      const totalCount = entries.slice(1, 15).reduce((acc, entry) => acc + entry.count, 0)

      return Math.round(totalCount / 14)
    }),
    change: pipe(requireAuth, (entries) => {
      const totalCountCurrent = entries.slice(1, 8).reduce((acc, entry) => acc + entry.count, 0)
      const totalCountPrevious = entries.slice(8, 15).reduce((acc, entry) => acc + entry.count, 0)
      const totalDifference = totalCountCurrent - totalCountPrevious

      if (totalCountPrevious === 0) return

      return Math.min(Math.max(Math.round((totalDifference / totalCountPrevious) * 100), -100), 100)
    }),
  },
  AverageDuration: {
    count: pipe(requireAuth, (entries) => {
      const totalCount = entries.slice(1, 15).reduce((acc, entry) => acc + entry.count, 0)

      return Math.round(totalCount / 14)
    }),
    change: pipe(requireAuth, (entries) => {
      const totalCountCurrent = entries.slice(1, 8).reduce((acc, entry) => acc + entry.count, 0)
      const totalCountPrevious = entries.slice(8, 15).reduce((acc, entry) => acc + entry.count, 0)
      const totalDifference = totalCountCurrent - totalCountPrevious

      if (totalCountPrevious === 0) return

      return Math.min(Math.max(Math.round((totalDifference / totalCountPrevious) * 100), -100), 100)
    }),
  },
  Facts: {
    id: pipe(requireAuth, async (domain, args, { viewer }) => {
      const ids = await domainIds(domain, viewer)

      // Provide a static fallback id when there're domains to create a recursive id from
      if (ids.length === 0) return '882b8e8a-f30b-414d-85e1-00d8ed5585a6'

      // The interface caches by id, so Ackee's and GA4's numbers of the same domains must not share one
      return recursiveId(domain.source === SOURCE_GA4 ? ['GA4', ...ids] : ids)
    }),
    activeVisitors: pipe(requireAuth, async (domain, _, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      // GA4 is synced by day, so it knows nobody who is on the site right now
      if (domain.source === SOURCE_GA4) return 0
      const activeVisitors = await getActiveVisitors(ids, dateDetails)

      return activeVisitors
    }),
    averageViews: pipe(requireAuth, async (domain, _, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const entries = viewsOf(domain)(ids, VIEWS_TYPE_UNIQUE, INTERVALS_DAILY, 15, dateDetails)

      return entries
    }),
    averageDuration: pipe(requireAuth, async (domain, _, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const entries = durationsOf(domain)(ids, INTERVALS_DAILY, 15, dateDetails)

      return entries
    }),
    viewsToday: pipe(requireAuth, async (domain, _, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const entries = await viewsOf(domain)(ids, VIEWS_TYPE_UNIQUE, INTERVALS_DAILY, 1, dateDetails)

      return entries[0].count
    }),
    viewsMonth: pipe(requireAuth, async (domain, _, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const entries = await viewsOf(domain)(ids, VIEWS_TYPE_UNIQUE, INTERVALS_MONTHLY, 1, dateDetails)

      return entries[0].count
    }),
    viewsYear: pipe(requireAuth, async (domain, _, { dateDetails, viewer }) => {
      const ids = await domainIds(domain, viewer)
      const entries = await viewsOf(domain)(ids, VIEWS_TYPE_UNIQUE, INTERVALS_YEARLY, 1, dateDetails)

      return entries[0].count
    }),
  },
  Query: {
    facts: (parent, { source }) => ({ source }),
  },
}
