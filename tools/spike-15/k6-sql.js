// K6 load on one ClickHouse query written by measure-sql.js --k6, for variants B and C.
// Same shape as ../bench/report.js: 10 VU, 30 s, failures above 1 % fail the run.
//
//   tools/spike-15/k6-sql.sh <plan.json> <summary.json> [duration]
/* global __ENV */
import { check } from 'k6'
import encoding from 'k6/encoding'
import http from 'k6/http'

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
  thresholds: { http_req_failed: ['rate<0.01'] },
}

const plan = JSON.parse(open(__ENV.PLAN))
const authorization = `Basic ${encoding.b64encode(`${__ENV.CH_USER || 'default'}:${__ENV.CH_PASSWORD || ''}`)}`

const search = Object.entries({
  ...plan.settings,
  ...Object.fromEntries(Object.entries(plan.params).map(([key, value]) => [`param_${key}`, value])),
})
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  .join('&')

const url = `${__ENV.CH_URL}/?${search}`

export default function () {
  const response = http.post(url, plan.query, { headers: { Authorization: authorization }, timeout: '120s' })

  // An error inside a 200 cannot happen over HTTP, but an empty answer can: that is a
  // window without data, which would time nothing useful
  check(response, {
    'status 200': (r) => r.status === 200,
    'has rows': (r) => r.status === 200 && r.body.length > 0,
  })
}
