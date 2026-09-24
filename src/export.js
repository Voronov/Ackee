import express from 'express'

// A domain is metadata and stays in MongoDB, unlike the records the reports read
import * as domains from './database/domains.js'
import { getEventStore } from './stores/index.js'
import { BROWSERS_TYPE_NO_VERSION } from './constants/browsers.js'
import { DEVICES_TYPE_NO_MODEL } from './constants/devices.js'
import { INTERVALS_DAILY } from './constants/intervals.js'
import { REFERRERS_TYPE_WITH_SOURCE } from './constants/referrers.js'
import { SIZES_TYPE_BROWSER_RESOLUTION } from './constants/sizes.js'
import { SORTINGS_TOP } from './constants/sortings.js'
import { SYSTEMS_TYPE_NO_VERSION } from './constants/systems.js'
import { VIEWS_TYPE_TOTAL, VIEWS_TYPE_UNIQUE } from './constants/views.js'
import { RANGES_LAST_30_DAYS } from './constants/ranges.js'
import { workspaceIds } from './utils/domainIds.js'
import createDate from './utils/createDate.js'
import resolveViewer from './utils/viewer.js'
import config from './utils/config.js'
import KnownError from './utils/KnownError.js'

/*
 * Downloading a report as a file.
 *
 * An HTTP route rather than a GraphQL field: a download needs a filename and a content
 * type, and the browser has to be able to follow a plain link to it. Returning the rows
 * through the API and building the file in JavaScript would work, but not for someone
 * scripting against Ackee, which is the more likely reason to want this at all.
 */

/*
 * The store is resolved per request, like in the resolvers: `ACKEE_EVENT_STORE` is read
 * at runtime, and a download must not answer from a different store than the dashboard.
 */
const REPORTS = {
  'views': (ids, { limit, dateDetails }) =>
    getEventStore().views(ids, VIEWS_TYPE_TOTAL, INTERVALS_DAILY, limit, dateDetails),
  'unique-views': (ids, { limit, dateDetails }) =>
    getEventStore().views(ids, VIEWS_TYPE_UNIQUE, INTERVALS_DAILY, limit, dateDetails),
  'durations': (ids, { limit, dateDetails }) => getEventStore().durations(ids, INTERVALS_DAILY, limit, dateDetails),
  'pages': (ids, o) => getEventStore().pages(ids, SORTINGS_TOP, o.range, o.limit, o.dateDetails),
  'referrers': (ids, o) =>
    getEventStore().referrers(ids, SORTINGS_TOP, REFERRERS_TYPE_WITH_SOURCE, o.range, o.limit, o.dateDetails),
  'systems': (ids, o) =>
    getEventStore().systems(ids, SORTINGS_TOP, SYSTEMS_TYPE_NO_VERSION, o.range, o.limit, o.dateDetails),
  'devices': (ids, o) =>
    getEventStore().devices(ids, SORTINGS_TOP, DEVICES_TYPE_NO_MODEL, o.range, o.limit, o.dateDetails),
  'browsers': (ids, o) =>
    getEventStore().browsers(ids, SORTINGS_TOP, BROWSERS_TYPE_NO_VERSION, o.range, o.limit, o.dateDetails),
  'sizes': (ids, o) =>
    getEventStore().sizes(ids, SORTINGS_TOP, SIZES_TYPE_BROWSER_RESOLUTION, o.range, o.limit, o.dateDetails),
  'languages': (ids, o) => getEventStore().languages(ids, SORTINGS_TOP, o.range, o.limit, o.dateDetails),
  'countries': (ids, o) => getEventStore().countries(ids, SORTINGS_TOP, o.range, o.limit, o.dateDetails),
}

export const REPORT_NAMES = Object.keys(REPORTS)

// A field holding a comma, a quote or a line break has to be quoted, and a quote inside it
// doubled. Anything else passes through untouched.
const csvCell = (value) => {
  const text = value == null ? '' : String(value)

  return /[",\n\r]/.test(text) === true ? `"${text.replaceAll('"', '""')}"` : text
}

// Excel and Numbers read a file as the local encoding unless it starts with a byte order
// mark, which turns every non-Latin label into rubbish.
const BOM = String.fromCodePoint(65_279)

const toCsv = (rows) => {
  if (rows.length === 0) return ''

  // Reports differ in their columns, and a report can gain one later, so the header comes
  // from the rows rather than from a list kept in step with them by hand.
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))

  return `${BOM}${[header, ...body].join('\n')}\n`
}

/*
 * Trims a row down to what is worth reading elsewhere.
 *
 * The identifier is a recursive hash that means nothing outside a running instance. An
 * undefined field is dropped too: several readers return a `created` that only the
 * "recent" sorting fills in, and keeping it would add an empty column to every file.
 */
const forExport = (entry) =>
  Object.fromEntries(Object.entries(entry).filter(([key, value]) => key !== 'id' && value !== undefined))

const router = express.Router()

router.get('/export/:domainId/:report.:format', async (request, response) => {
  const { domainId, report, format } = request.params

  if (REPORTS[report] == null) {
    return response.status(404).json({ error: `Unknown report. Try one of: ${REPORT_NAMES.join(', ')}` })
  }

  if (['csv', 'json'].includes(format) === false) {
    return response.status(404).json({ error: 'Unknown format. Use csv or json.' })
  }

  const viewer = await resolveViewer(request.headers['authorization'], config.ttl)

  if (viewer instanceof KnownError) return response.status(401).json({ error: viewer.message })

  // Scoped like every other read: a domain outside the viewer's workspaces does not exist.
  const domain = await domains.get(domainId, workspaceIds(viewer))

  if (domain == null) return response.status(404).json({ error: 'Unknown domain' })

  const dateDetails = createDate(request.headers['time-zone'] ?? request.query.timeZone)
  const limit = Math.min(Number.parseInt(request.query.limit ?? '100', 10) || 100, 1000)
  const range = request.query.range ?? RANGES_LAST_30_DAYS

  const rows = (await REPORTS[report]([domain.id], { limit, range, dateDetails })).map((entry) => forExport(entry))
  const filename = `${domain.title.replaceAll(/[^\w.-]/g, '-')}-${report}.${format}`

  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

  if (format === 'json') return response.json(rows)

  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.send(toCsv(rows))
})

export default router
