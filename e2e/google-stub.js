// A stand-in for Google, for the browser tests: the token endpoint of a service account and the
// GA4 Data API, answering with fixed numbers for every day asked for. Nothing leaves the compose
// network, and no real key is needed (ACKEE-21).
import http from 'node:http'

const DAY = { views: 10, users: 4, sessions: 5, seconds: 60 }
const LISTS = {
  fullPageUrl: [
    ['datum-shop.pages.dev/', 6],
    ['datum-shop.pages.dev/cart/', 4],
  ],
  sessionSource: [
    ['google', 7],
    ['(direct)', 3],
  ],
}

const resolve = (value) => {
  if (value === 'today') return new Date().toISOString().slice(0, 10)
  if (value.endsWith('daysAgo'))
    return new Date(Date.now() - Number.parseInt(value, 10) * 864e5).toISOString().slice(0, 10)
  return value
}

// GA4 writes a day as 20260925
const days = (startDate, endDate) => {
  const out = []
  for (
    let date = new Date(resolve(startDate));
    date <= new Date(resolve(endDate));
    date = new Date(date.getTime() + 864e5)
  ) {
    out.push(date.toISOString().slice(0, 10).replaceAll('-', ''))
  }
  return out
}

const answer = (report) => {
  const [{ startDate, endDate }] = report.dateRanges
  const dimension = report.dimensions?.[1]?.name

  // The check of the connection asks for a total without dimensions
  if (report.dimensions == null) return [{ metricValues: [{ value: String(DAY.views) }] }]

  return days(startDate, endDate).flatMap((date) => {
    if (dimension == null) {
      return [
        {
          dimensionValues: [{ value: date }],
          metricValues: [DAY.views, DAY.users, DAY.sessions, DAY.seconds].map((value) => ({ value: String(value) })),
        },
      ]
    }

    return (LISTS[dimension] ?? [['(not set)', DAY.views]]).map(([value, views]) => ({
      dimensionValues: [{ value: date }, { value }],
      metricValues: [{ value: String(views) }],
    }))
  })
}

http
  .createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const send = (status, json) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(json))
      }

      if (request.url === '/token') return send(200, { access_token: 'token-of-the-stand-in', expires_in: 3600 })

      if (/properties\/\d+:runReport/.test(request.url)) {
        if (request.headers.authorization !== 'Bearer token-of-the-stand-in')
          return send(401, { error: { message: 'Unauthenticated' } })

        const rows = answer(JSON.parse(body))
        return send(200, { rows, rowCount: rows.length })
      }

      send(404, { error: { message: 'Not a Google address' } })
    })
  })
  .listen(4000)
