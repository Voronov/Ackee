import { SOURCE_GA4 } from './constants/ga4.js'
import * as auditLog from './database/auditLog.js'
import { executor, workspacesOf } from './mcp/server.js'
import config from './utils/config.js'
import KnownError from './utils/KnownError.js'
import resolveViewer from './utils/viewer.js'

/*
 * Reports as files, /export/<report>.<csv|json> (ACKEE-22). An agency opens them in Excel or
 * a script. Like /mcp, the export runs fixed queries of the reports API as the viewer of the
 * token, so every workspace rule of /api applies; a domain the token may not read is 404, the
 * same answer as a domain that does not exist.
 */

const LIST = 'value count created'

// The report names come from this table only, never from the request
const REPORTS = {
  views: {
    field: 'views',
    chart: true,
    args: ['interval', 'type', 'limit'],
    defaults: { interval: 'DAILY', type: 'TOTAL', limit: 14 },
  },
  durations: {
    field: 'durations',
    chart: true,
    args: ['interval', 'limit'],
    defaults: { interval: 'DAILY', limit: 14 },
  },
  pages: { field: 'pages', args: ['sorting', 'range', 'limit'] },
  referrers: { field: 'referrers', args: ['sorting', 'type', 'range', 'limit'], defaults: { type: 'WITH_SOURCE' } },
  systems: { field: 'systems', args: ['sorting', 'type', 'range', 'limit'], defaults: { type: 'WITH_VERSION' } },
  devices: { field: 'devices', args: ['sorting', 'type', 'range', 'limit'], defaults: { type: 'WITH_MODEL' } },
  browsers: { field: 'browsers', args: ['sorting', 'type', 'range', 'limit'], defaults: { type: 'WITH_VERSION' } },
  sizes: { field: 'sizes', args: ['sorting', 'type', 'range', 'limit'], defaults: { type: 'BROWSER_RESOLUTION' } },
  languages: { field: 'languages', args: ['sorting', 'range', 'limit'] },
  countries: { field: 'countries', args: ['sorting', 'range', 'limit'], extra: 'code' },
}

// The GraphQL type of each argument, `type` from TYPE_ENUMS. The schema checks the values.
const ARG_TYPES = {
  interval: 'Interval!',
  limit: 'Int',
  sorting: 'Sorting!',
  range: 'Range',
}

const TYPE_ENUMS = {
  views: 'ViewType!',
  referrers: 'ReferrerType!',
  systems: 'SystemType!',
  devices: 'DeviceType!',
  browsers: 'BrowserType!',
  sizes: 'SizeType!',
}

const FORMATS = new Set(['csv', 'json'])

// A chart builds one entry per unit of the limit, so a huge limit would block the server
const MAX_LIMIT = { chart: 366, list: 1000 }

// Only the arguments that were given: one left out keeps the default of the schema, a null would not
const queryOf = (name, report, given) => {
  const present = report.args.filter((arg) => given[arg] !== undefined)
  const variables = present.map((arg) => `$${arg}: ${arg === 'type' ? TYPE_ENUMS[name] : ARG_TYPES[arg]}`)
  const args = present.map((arg) => `${arg}: $${arg}`)
  const fields = report.chart === true ? 'value count' : [LIST, report.extra].filter(Boolean).join(' ')

  return `query export($domainId: ID, $source: StatisticsSource, ${variables.join(', ')}) {
    statistics(domainId: $domainId, source: $source) { entries: ${report.field}(${args.join(', ')}) { ${fields} } }
  }`
}

const limitOf = (report, value) => {
  const maximum = report.chart === true ? MAX_LIMIT.chart : MAX_LIMIT.list
  const limit = Number(value)

  if (Number.isInteger(limit) === false || limit < 1 || limit > maximum) {
    throw new Error(`The limit must be from 1 to ${maximum}`)
  }

  return limit
}

const variablesOf = (report, query) => {
  const variables = { sorting: 'TOP', ...report.defaults }

  for (const arg of report.args) {
    const value = query[arg]
    if (typeof value !== 'string') continue
    variables[arg] = arg === 'limit' ? limitOf(report, value) : value
  }

  return Object.fromEntries(
    report.args.filter((arg) => variables[arg] !== undefined).map((arg) => [arg, variables[arg]]),
  )
}

// Values of the lists come from the tracker, so anyone can set them. A cell that starts like a
// formula would run in Excel (CSV injection), so it gets a quote in front.
const FORMULA = /^[=+\-@\t\r]/u

const cell = (value) => {
  if (value == null) return ''
  if (typeof value === 'number') return String(value)

  const text = FORMULA.test(value) ? `'${value}` : value
  return /[",;\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const BOM = '\u{FEFF}'

// UTF-8 with a byte order mark, so Excel reads Cyrillic and other scripts right. CRLF, as RFC 4180 has it.
export const toCsv = (columns, entries, delimiter = ',') => {
  const rows = [columns, ...entries.map((entry) => columns.map((column) => entry[column]))]
  return `${BOM}${rows.map((row) => row.map(cell).join(delimiter)).join('\r\n')}\r\n`
}

const columnsOf = (report) => {
  if (report.chart === true) return ['value', 'count']
  return ['value', ...(report.extra == null ? [] : [report.extra]), 'count', 'created']
}

const fail = (response, status, message) =>
  response.status(status).set('Cache-Control', 'no-store').json({ error: message })

export default async (request, response) => {
  const match = /^([a-z]+)\.([a-z]+)$/u.exec(request.params.file)
  const known = match != null && Object.hasOwn(REPORTS, match[1])
  const report = known === true ? REPORTS[match[1]] : undefined

  if (report == null || FORMATS.has(match[2]) === false) return fail(response, 404, 'Unknown report')

  // The same tokens as /api, permanent ones included
  const viewer = await resolveViewer(request.headers.authorization, config.ttl)
  if (viewer instanceof KnownError) return fail(response, 401, viewer.message)

  const [, name, format] = match
  const domainId = typeof request.query.domainId === 'string' ? request.query.domainId : undefined
  const source = typeof request.query.source === 'string' ? request.query.source : undefined

  let outcome = 'ok'

  try {
    const given = variablesOf(report, request.query)
    const variables = { domainId, ...given, ...(source == null ? {} : { source }) }
    const data = await executor(viewer, request.headers)(queryOf(name, report, given), variables)
    const entries = data.statistics.entries ?? []
    const filename = `ackee-${name}${source === SOURCE_GA4 ? '-ga4' : ''}-${new Date().toISOString().slice(0, 10)}.${format}`

    response.set('Cache-Control', 'no-store')
    response.set('Content-Disposition', `attachment; filename="${filename}"`)

    if (format === 'json') return response.json(entries)

    const delimiter = request.query.delimiter === 'semicolon' ? ';' : ','
    response.type('text/csv; charset=utf-8').send(toCsv(columnsOf(report), entries, delimiter))
  } catch (error) {
    outcome = `error: ${error.message}`
    // A foreign domain answers like a missing one; anything else is a wrong argument
    if (error.message.includes('Unknown domain')) return fail(response, 404, 'Unknown domain')
    return fail(response, 400, error.message)
  } finally {
    // Every export lands in the audit log, failed ones too, as the calls of /mcp do
    for (const workspaceId of await workspacesOf(viewer, domainId == null ? [] : [domainId])) {
      await auditLog.record(viewer, workspaceId, `export.${name}`, domainId, `${outcome} ${format}`.slice(0, 200))
    }
  }
}
