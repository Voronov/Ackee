// K6 load on one GraphQL report of Ackee, for v1.0, A and B of ACKEE-15. Same shape and the
// same two queries as ../bench/report.js, plus views TOTAL and durations, which report.js
// leaves out but the criterion of the decision covers.
//
//   tools/spike-15/k6-api.sh <summary.json> <base-url-for-docker> <domain> <token> <report> [duration]
/* global __ENV */
import { check } from 'k6'
import http from 'k6/http'

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
  thresholds: { http_req_failed: ['rate<0.01'] },
}

const queries = {
  'views-unique': `query views($id: ID!) { domain(id: $id) { statistics { views(interval: DAILY, type: UNIQUE, limit: 30) { id count } } } }`,
  'views-total': `query views($id: ID!) { domain(id: $id) { statistics { views(interval: DAILY, type: TOTAL, limit: 30) { id count } } } }`,
  'referrers': `query referrers($id: ID!) { domain(id: $id) { statistics { referrers(sorting: TOP, type: WITH_SOURCE, range: LAST_30_DAYS) { id value count } } } }`,
  'durations': `query durations($id: ID!) { domain(id: $id) { statistics { durations(interval: DAILY, limit: 30) { id count } } } }`,
}

const query = queries[__ENV.REPORT]
if (query == null) throw new Error(`Unknown REPORT ${__ENV.REPORT}, one of ${Object.keys(queries).join(', ')}`)

export default function () {
  const response = http.post(`${__ENV.BASE}/api`, JSON.stringify({ query, variables: { id: __ENV.DOMAIN } }), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.TOKEN}`,
      'Time-Zone': 'Europe/Kiev',
    },
    timeout: '120s',
  })

  check(response, {
    'status 200': (r) => r.status === 200,
    'has data': (r) => r.status === 200 && r.json('data.domain.statistics') != null && r.json('errors') == null,
  })
}
