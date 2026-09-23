/*
 * The tools an assistant can call.
 *
 * Every tool is one question someone would actually ask about a site, not one field of
 * the schema. "Which pages were read most last week" is a tool; `statistics.pages` with
 * four enum arguments is not. A model picks a tool from its description, so the
 * descriptions say when to use each one rather than what it returns.
 */

const RANGES = ['LAST_24_HOURS', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_6_MONTHS']
const INTERVALS = ['DAILY', 'MONTHLY', 'YEARLY']

// Which report each name maps to, and the arguments that report needs beyond the common
// ones. Keeping them in a table means one tool covers ten reports.
const BREAKDOWNS = {
  pages: { field: 'pages' },
  referrers: { field: 'referrers', arguments: 'type: WITH_SOURCE' },
  countries: { field: 'countries' },
  languages: { field: 'languages' },
  browsers: { field: 'browsers', arguments: 'type: NO_VERSION' },
  systems: { field: 'systems', arguments: 'type: NO_VERSION' },
  devices: { field: 'devices', arguments: 'type: NO_MODEL' },
  sizes: { field: 'sizes', arguments: 'type: BROWSER_RESOLUTION' },
}

const required = (properties, names) => ({
  type: 'object',
  properties,
  required: names,
  additionalProperties: false,
})

const domainProperty = {
  type: 'string',
  description: 'Identifier of the domain, as returned by list_domains.',
}

const rangeProperty = {
  type: 'string',
  enum: RANGES,
  description: 'How far back to look. Defaults to the last 7 days.',
}

export default (request) => [
  {
    name: 'list_domains',
    description:
      'Lists the sites this Ackee account can read, with their identifiers. Call this first: every other tool needs a domain id, and the id is not the domain name.',
    inputSchema: required({}, []),
    handler: async () => {
      const data = await request(`query { domains { id title } }`)

      return data.domains
    },
  },
  {
    name: 'get_facts',
    description:
      'The headline numbers for one site: visitors on it right now, views today, this month and this year, and the average views and visit duration with their change against the week before. Use this to answer "how is the site doing".',
    inputSchema: required({ domainId: domainProperty }, ['domainId']),
    handler: async ({ domainId }) => {
      const data = await request(
        `query facts($id: ID!) {
          domain(id: $id) {
            title
            facts {
              activeVisitors
              viewsToday
              viewsMonth
              viewsYear
              averageViews { count change }
              averageDuration { count change }
            }
          }
        }`,
        { id: domainId },
      )

      if (data.domain == null) throw new Error(`No domain with id '${domainId}'. Call list_domains first.`)

      return { title: data.domain.title, ...data.domain.facts }
    },
  },
  {
    name: 'get_views_over_time',
    description:
      'Views of one site as a series over time, for spotting a trend, a spike or a drop. UNIQUE counts visitors, TOTAL counts page views.',
    inputSchema: required(
      {
        domainId: domainProperty,
        interval: { type: 'string', enum: INTERVALS, description: 'One point per day, month or year.' },
        type: { type: 'string', enum: ['UNIQUE', 'TOTAL'], description: 'Visitors or page views.' },
        limit: { type: 'integer', description: 'How many points to return. Defaults to 14.' },
      },
      ['domainId'],
    ),
    handler: async ({ domainId, interval = 'DAILY', type = 'UNIQUE', limit = 14 }) => {
      const data = await request(
        `query views($id: ID!, $interval: Interval!, $type: ViewType!, $limit: Int!) {
          domain(id: $id) {
            statistics { views(interval: $interval, type: $type, limit: $limit) { value count } }
          }
        }`,
        { id: domainId, interval, type, limit },
      )

      if (data.domain == null) throw new Error(`No domain with id '${domainId}'. Call list_domains first.`)

      return data.domain.statistics.views
    },
  },
  {
    name: 'get_breakdown',
    description: `Ranks one dimension of a site's traffic. Use it to answer which pages were read, where visitors came from, which countries, languages, browsers, operating systems, devices or screen sizes they used. One of: ${Object.keys(BREAKDOWNS).join(', ')}.`,
    inputSchema: required(
      {
        domainId: domainProperty,
        breakdown: { type: 'string', enum: Object.keys(BREAKDOWNS), description: 'Which dimension to rank.' },
        range: rangeProperty,
        limit: { type: 'integer', description: 'How many entries to return. Defaults to 10.' },
      },
      ['domainId', 'breakdown'],
    ),
    handler: async ({ domainId, breakdown, range = 'LAST_7_DAYS', limit = 10 }) => {
      const entry = BREAKDOWNS[breakdown]

      if (entry == null) {
        throw new Error(`Unknown breakdown '${breakdown}'. One of: ${Object.keys(BREAKDOWNS).join(', ')}.`)
      }

      const extra = entry.arguments == null ? '' : `, ${entry.arguments}`

      const data = await request(
        `query breakdown($id: ID!, $range: Range!, $limit: Int!) {
          domain(id: $id) {
            statistics {
              ${entry.field}(sorting: TOP, range: $range, limit: $limit${extra}) { value count }
            }
          }
        }`,
        { id: domainId, range, limit },
      )

      if (data.domain == null) throw new Error(`No domain with id '${domainId}'. Call list_domains first.`)

      return data.domain.statistics[entry.field]
    },
  },
  {
    name: 'get_durations',
    description:
      'How long a visit to one site lasts on average, as a series over time, in milliseconds. Use it to tell a page people read from one they leave at once.',
    inputSchema: required(
      {
        domainId: domainProperty,
        interval: { type: 'string', enum: INTERVALS, description: 'One point per day, month or year.' },
        limit: { type: 'integer', description: 'How many points to return. Defaults to 14.' },
      },
      ['domainId'],
    ),
    handler: async ({ domainId, interval = 'DAILY', limit = 14 }) => {
      const data = await request(
        `query durations($id: ID!, $interval: Interval!, $limit: Int!) {
          domain(id: $id) {
            statistics { durations(interval: $interval, limit: $limit) { value count } }
          }
        }`,
        { id: domainId, interval, limit },
      )

      if (data.domain == null) throw new Error(`No domain with id '${domainId}'. Call list_domains first.`)

      return data.domain.statistics.durations
    },
  },
  {
    name: 'get_recent_pages',
    description:
      'The pages of one site that were opened most recently, newest first. Use it to see what is being read right now, rather than what was read most over a period.',
    inputSchema: required(
      {
        domainId: domainProperty,
        limit: { type: 'integer', description: 'How many entries to return. Defaults to 10.' },
      },
      ['domainId'],
    ),
    handler: async ({ domainId, limit = 10 }) => {
      const data = await request(
        `query recent($id: ID!, $limit: Int!) {
          domain(id: $id) {
            statistics { pages(sorting: RECENT, limit: $limit) { value created } }
          }
        }`,
        { id: domainId, limit },
      )

      if (data.domain == null) throw new Error(`No domain with id '${domainId}'. Call list_domains first.`)

      return data.domain.statistics.pages
    },
  },
]
