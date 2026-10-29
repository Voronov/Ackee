import * as z from 'zod/v4'

/*
 * The six tools of the MCP endpoint (ACKEE-27, ADR-008). Each one runs a fixed GraphQL query
 * of the reports API: the caller picks values from enums, never a field or a document, so
 * nothing but these reads can reach the schema. The `execute` passed to `run` carries the
 * viewer of the token, so every workspace rule of the API applies as it does for /api.
 */

const INTERVALS = ['DAILY', 'MONTHLY', 'YEARLY']
const VIEW_TYPES = ['TOTAL', 'UNIQUE']
const RANGES = ['LAST_24_HOURS', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_6_MONTHS']

// Every top list, with the type its report needs. The field name comes from this table only.
// Countries join the list with ACKEE-100.
const DIMENSIONS = {
  pages: { field: 'pages', type: null },
  referrers: { field: 'referrers', type: 'WITH_SOURCE' },
  browsers: { field: 'browsers', type: 'WITH_VERSION' },
  systems: { field: 'systems', type: 'WITH_VERSION' },
  devices: { field: 'devices', type: 'WITH_MODEL' },
  sizes: { field: 'sizes', type: 'BROWSER_RESOLUTION' },
  languages: { field: 'languages', type: null },
}

const domainId = z
  .string()
  .optional()
  .describe('A domain id from the domains tool. Leave it out for all domains together.')
const interval = z.enum(INTERVALS).default('DAILY').describe('One entry per day, month or year')
const viewType = z.enum(VIEW_TYPES).default('TOTAL').describe('TOTAL counts page views, UNIQUE counts visitors')
const count = (fallback, maximum, about) =>
  z.number().int().min(1).max(maximum).default(fallback).describe(`${about} (1 to ${maximum})`)

const sum = (entries) => entries.reduce((total, entry) => total + (entry.count ?? 0), 0)

const views = async (execute, { domainId, interval, type, limit }) => {
  const data = await execute(
    `query($domainId: ID, $interval: Interval!, $type: ViewType!, $limit: Int) {
      statistics(domainId: $domainId) { views(interval: $interval, type: $type, limit: $limit) { id value count } }
    }`,
    { domainId, interval, type, limit },
  )

  return data.statistics.views
}

export default [
  {
    name: 'domains',
    description:
      'The domains (sites) this token may read, with their ids. Start here: the other tools take a domainId from this list, or none for all domains together.',
    inputSchema: {},
    run: async (args, execute) => (await execute('{ domains { id title } }')).domains,
  },
  {
    name: 'report',
    description:
      'Views or visit durations over time, newest entry first: one entry per day, month or year. Durations are in milliseconds.',
    inputSchema: {
      domainId,
      metric: z.enum(['views', 'durations']).default('views'),
      interval,
      type: viewType.describe('For views only: TOTAL counts page views, UNIQUE counts visitors'),
      limit: count(14, 100, 'How many entries, starting with the current one'),
    },
    run: async ({ domainId, metric, interval, type, limit }, execute) => {
      if (metric === 'durations') {
        const data = await execute(
          `query($domainId: ID, $interval: Interval!, $limit: Int) {
            statistics(domainId: $domainId) { durations(interval: $interval, limit: $limit) { id value count } }
          }`,
          { domainId, interval, limit },
        )

        return { metric, interval, unit: 'milliseconds', entries: data.statistics.durations }
      }

      return { metric, interval, type, entries: await views(execute, { domainId, interval, type, limit }) }
    },
  },
  {
    name: 'top',
    description:
      'A top list for a range: the most visited pages, the referrers visitors came from, or their browsers, systems, devices, screen sizes or languages.',
    inputSchema: {
      domainId,
      dimension: z.enum(Object.keys(DIMENSIONS)).describe('Which list'),
      range: z.enum(RANGES).default('LAST_7_DAYS'),
      limit: count(10, 100, 'How many entries'),
    },
    run: async ({ domainId, dimension, range, limit }, execute) => {
      const { field, type } = DIMENSIONS[dimension]
      const data = await execute(
        `query($domainId: ID, $range: Range, $limit: Int) {
          statistics(domainId: $domainId) {
            ${field}(sorting: TOP${type == null ? '' : `, type: ${type}`}, range: $range, limit: $limit) { value count }
          }
        }`,
        { domainId, range, limit },
      )

      return { dimension, range, entries: data.statistics[field] }
    },
  },
  {
    name: 'live',
    description:
      'What is happening now: visitors on the site at this moment, unique views today, this month and this year, and the averages of the last two weeks with their change.',
    inputSchema: { domainId },
    run: async ({ domainId }, execute) => {
      const data = await execute(
        `query($domainId: ID) {
          facts(domainId: $domainId) {
            activeVisitors viewsToday viewsMonth viewsYear
            averageViews { count change }
            averageDuration { count change }
          }
        }`,
        { domainId },
      )

      return data.facts
    },
  },
  {
    name: 'events',
    description:
      'The events of the workspace (tracked actions like a sale or a sign-up): their totals per day of the last two weeks and the top keys of the last seven days.',
    inputSchema: { limit: count(10, 100, 'How many keys per event') },
    run: async ({ limit }, execute) => {
      const data = await execute(
        `query($limit: Int) {
          events {
            id title type
            statistics {
              chart(interval: DAILY, type: TOTAL, limit: 14) { value count }
              list(sorting: TOP, type: TOTAL, range: LAST_7_DAYS, limit: $limit) { value count }
            }
          }
        }`,
        { limit },
      )

      return data.events.map((event) => ({
        id: event.id,
        title: event.title,
        type: event.type,
        perDay: event.statistics.chart,
        topKeys: event.statistics.list,
      }))
    },
  },
  {
    name: 'compare',
    description:
      'Views of one or more domains side by side, each with the sum of the current period and of the one before it, and the change in percent. One domain compares two periods; several compare the domains.',
    inputSchema: {
      domainIds: z.array(z.string()).min(1).max(10).describe('Domain ids from the domains tool'),
      interval,
      type: viewType,
      periods: count(7, 50, 'Length of each period, in entries of the interval'),
    },
    run: async ({ domainIds, interval, type, periods }, execute) => {
      const { domains } = await execute('{ domains { id title } }')
      const titles = Object.fromEntries(domains.map((domain) => [domain.id, domain.title]))

      const rows = []

      for (const domainId of domainIds) {
        const entries = await views(execute, { domainId, interval, type, limit: periods * 2 })
        const current = sum(entries.slice(0, periods))
        const previous = sum(entries.slice(periods))

        rows.push({
          domainId,
          title: titles[domainId],
          current,
          previous,
          change: previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10,
        })
      }

      return { interval, type, periods, domains: rows }
    },
  },
]
