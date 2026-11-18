// Load by k6 on the domain dashboard of the benchmark stand (ACKEE-105, NFR of ADR-004: p95 ≤ 300 ms
// per report at 10 VU). Each VU sends the dashboard's views, durations, referrers and facts
// queries one after another, without pauses, so 10 requests are open all the time.
// The queries are those of src/ui/scripts/api/hooks, see docs/engineering/benchmark-stand.md.
//
//   docker run --rm -i --add-host host.docker.internal:host-gateway -v "$PWD/scripts:/scripts:ro" \
//     -e BASE=http://host.docker.internal:3100 -e PERIOD_FROM=2026-10-06 -e PERIOD_TO=2026-11-04 \
//     grafana/k6:2.2.0 run /scripts/load-dashboard.js
//
// FILTER=referrer adds the cross filter of ACKEE-24: the top referrer, as a click on it sends.
/* global __ENV */
/* eslint-disable import-x/no-unresolved */
import { check, fail } from 'k6'
import http from 'k6/http'
import { Rate } from 'k6/metrics'
/* eslint-enable import-x/no-unresolved */

const BASE = __ENV.BASE || 'http://host.docker.internal:3100'
const TIME_ZONE = __ENV.TIME_ZONE || 'UTC'
const FILTER = __ENV.FILTER || 'none'
// A period of the dashboard (ACKEE-24); without it the dashboard shows the last 14 days and 24 hours
const PERIOD = __ENV.PERIOD_FROM ? { from: __ENV.PERIOD_FROM, to: __ENV.PERIOD_TO } : null
const REPORTS = ['views', 'durations', 'referrers', 'facts']

// GraphQL errors come with status 200, so a failure is counted here and not by http_req_failed
const failures = new Rate('report_failures')

export const options = {
  scenarios: {
    dashboard: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || '60s',
      // Requests still open at the end are waited for, so slow reports are measured and not dropped
      gracefulStop: __ENV.GRACEFUL_STOP || '30s',
    },
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: {
    report_failures: ['rate<0.01'],
    ...Object.fromEntries(REPORTS.map((report) => [`http_req_duration{report:${report}}`, ['p(95)<=300']])),
    ...Object.fromEntries(REPORTS.map((report) => [`report_failures{report:${report}}`, ['rate<0.01']])),
  },
}

const queries = {
  views: `query fetchViews($id: ID!, $interval: Interval!, $type: ViewType!, $limit: Int, $source: StatisticsSource, $filters: [FilterInput!], $period: PeriodInput) {
    domain(id: $id) { id statistics(source: $source, filters: $filters, period: $period) { id views(interval: $interval, type: $type, limit: $limit) { id count } } }
  }`,
  durations: `query fetchDurations($id: ID!, $interval: Interval!, $limit: Int, $source: StatisticsSource, $filters: [FilterInput!], $period: PeriodInput) {
    domain(id: $id) { id statistics(source: $source, filters: $filters, period: $period) { id durations(interval: $interval, limit: $limit) { id count } } }
  }`,
  referrers: `query fetchReferrers($id: ID!, $sorting: Sorting!, $type: ReferrerType!, $range: Range, $source: StatisticsSource, $filters: [FilterInput!], $period: PeriodInput) {
    domain(id: $id) { id statistics(source: $source, filters: $filters, period: $period) { id referrers(sorting: $sorting, type: $type, range: $range) { id value count filter { field value } created } } }
  }`,
  facts: `query fetchFacts($id: ID!, $source: StatisticsSource, $filters: [FilterInput!]) {
    domain(id: $id) { id facts(source: $source, filters: $filters) { id activeVisitors averageViews { count change } averageDuration { count change } viewsToday viewsMonth viewsYear } }
  }`,
}

// The variables of RouteDomain.js; with a period the UI asks for as many days as it has
const limit = PERIOD == null ? 14 : 30
const variables = {
  views: { interval: 'DAILY', type: 'UNIQUE', limit, period: PERIOD },
  durations: { interval: 'DAILY', limit, period: PERIOD },
  referrers: { sorting: 'TOP', type: 'WITH_SOURCE', range: 'LAST_24_HOURS', period: PERIOD },
  facts: {},
}

const post = (query, vars, token, tags) =>
  http.post(`${BASE}/api`, JSON.stringify({ query, variables: vars }), {
    headers: {
      'Content-Type': 'application/json',
      'Time-Zone': TIME_ZONE,
      ...(token == null ? {} : { Authorization: `Bearer ${token}` }),
    },
    timeout: __ENV.TIMEOUT || '120s',
    tags,
  })

const data = (response) => (response.status === 200 && response.json('errors') == null ? response.json('data') : null)

export const setup = () => {
  const login = post(
    'mutation createToken($input: CreateTokenInput!) { createToken(input: $input) { payload { id } } }',
    { input: { username: __ENV.USERNAME || 'bench', password: __ENV.PASSWORD || 'bench' } },
    null,
    { report: 'setup' },
  )
  const token = data(login)?.createToken.payload.id ?? fail(`Login failed: ${login.status} ${login.body}`)

  const domains = data(post('query { domains { id title } }', {}, token, { report: 'setup' }))?.domains ?? []
  const domain = __ENV.DOMAIN || (domains.length === 1 ? domains[0].id : fail(`Pass DOMAIN, found ${domains.length}`))

  if (FILTER === 'none') return { token, domain, filters: null }
  if (FILTER !== 'referrer') fail(`Unknown FILTER ${FILTER}, one of none, referrer`)

  const top = data(post(queries.referrers, { ...variables.referrers, id: domain }, token, { report: 'setup' }))
  const filters = top?.domain.statistics.referrers[0]?.filter ?? fail('No referrer to filter by')
  console.log(`Filter: ${JSON.stringify(filters)}`)

  return { token, domain, filters }
}

export default ({ token, domain, filters }) => {
  for (const report of REPORTS) {
    const response = post(queries[report], { ...variables[report], id: domain, source: 'ACKEE', filters }, token, {
      report,
    })
    const ok = check(response, { [`${report} has data`]: (r) => data(r)?.domain != null })
    failures.add(ok === false, { report })
  }
}

export const teardown = ({ token }) => {
  post('mutation deleteToken($id: ID!) { deleteToken(id: $id) { success } }', { id: token }, token, {
    report: 'setup',
  })
}
