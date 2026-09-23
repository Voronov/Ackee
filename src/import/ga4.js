import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { day } from '../utils/times.js'

/*
 * Reads a CSV exported from Google Analytics 4.
 *
 * GA4 gives you aggregates, not events: a row says "this page had 42 views on this date",
 * with no way back to the 42 individual visits. Ackee stores events. So the importer
 * expands each row into that many records, spread evenly across the day.
 *
 * What that costs is stated plainly in the docs: imported records carry no visitor hash,
 * because there is nothing to derive one from. Unique views over an imported period will
 * therefore read lower than they were. Everything counted by occurrence — page views,
 * referrers, countries, browsers — comes out right.
 */

// GA4 labels the same column differently depending on the report and the interface
// language setting, so each field accepts several spellings.
const COLUMNS = {
  date: ['date', 'day', 'ga:date'],
  path: ['page path', 'page path and screen class', 'page path + query string', 'pagepath', 'landing page'],
  views: ['views', 'screen page views', 'screenpageviews', 'pageviews', 'page views', 'sessions'],
  country: ['country'],
  referrer: ['session source', 'source', 'referrer', 'session source / medium'],
  browser: ['browser'],
  os: ['operating system', 'os'],
  device: ['device category', 'device'],
}

const normalise = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()

// GA4 exports country names, not codes. Taking the first two letters would turn "Ukraine"
// into UK, which is the United Kingdom — quietly wrong data rather than missing data.
// Intl already knows every code and its English name, so the table is built from it.
// Codes Intl still answers for although they name a country that no longer exists or is
// an alias of another code. Left in, they win by alphabet and quietly poison the data:
// DD ("Germany", the GDR) would beat DE, and UK would beat GB.
const RETIRED = new Set(['AN', 'BU', 'CS', 'DD', 'FX', 'NT', 'QU', 'SU', 'TP', 'UK', 'YD', 'YU', 'ZR'])

const COUNTRY_BY_NAME = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' })
  const table = new Map()

  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCodePoint(first, second)

      if (RETIRED.has(code) === true) continue

      try {
        const name = names.of(code)

        // Intl echoes the code back when it knows no name for it.
        if (name != null && name !== code) table.set(normalise(name), code)
      } catch {
        // Not a region code.
      }
    }
  }

  return table
})()

export const readCountry = (value) => {
  const text = normalise(value)

  if (text === '') return null
  if (/^[a-z]{2}$/.test(text) === true) return text.toUpperCase()

  return COUNTRY_BY_NAME.get(text) ?? null
}

// A quoted CSV field can hold commas, so splitting on the separator alone is not enough.
export const splitRow = (line) => {
  const values = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index++) {
    const character = line[index]

    if (character === '"') {
      // Two quotes in a row inside a quoted field mean one literal quote.
      if (quoted === true && line[index + 1] === '"') {
        current += '"'
        index++
      } else {
        quoted = quoted === false
      }
    } else if (character === ',' && quoted === false) {
      values.push(current)
      current = ''
    } else {
      current += character
    }
  }

  values.push(current)

  return values.map((value) => value.trim())
}

// Maps the header row onto the fields above. Returns null when the row is not a header,
// which is how the metadata block GA4 puts at the top of an export gets skipped.
export const readHeader = (line) => {
  const cells = splitRow(line).map((cell) => normalise(cell))
  const mapping = {}

  for (const [field, aliases] of Object.entries(COLUMNS)) {
    const index = cells.findIndex((cell) => aliases.includes(cell))

    if (index !== -1) mapping[field] = index
  }

  // A count is the one column that has to be there. The date is not: GA4's most common
  // export, "Pages and screens", has no date at all, and the importer takes one from
  // --date instead. Requiring it here would reject the very file people arrive with.
  return mapping.views == null || Object.keys(mapping).length < 2 ? null : mapping
}

// GA4 writes dates as 20260922, the API as 2026-09-22. Both mean the same day.
export const readDate = (value) => {
  const text = String(value ?? '').trim()
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const parts = compact ?? dashed

  if (parts == null) return null

  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))

  return Number.isNaN(date.getTime()) ? null : date
}

const cell = (values, mapping, field) => (mapping[field] == null ? null : values[mapping[field]] || null)

// A source of "(direct)" or "(none)" means there was no referrer, not one with that name.
const readReferrer = (value) => {
  const text = String(value ?? '')
    .split('/')[0]
    .trim()

  // "(direct)" and "(none)" mean there was no referrer, not one with that name.
  if (text === '' || text.startsWith('(')) return null

  return text.includes('://') ? text : `https://${text}`
}

/*
 * Turns one row into as many records as it counts.
 *
 * The views are spread evenly across the day rather than all landing at midnight, so that
 * a daily report looks like traffic instead of a spike.
 */
export const expandRow = ({ values, mapping, domainId, origin, limit, fallbackDate }) => {
  const date = readDate(cell(values, mapping, 'date')) ?? fallbackDate ?? null
  const views = Number.parseInt(cell(values, mapping, 'views') ?? '0', 10)

  if (date == null || Number.isNaN(views) === true || views <= 0) return []

  const count = limit == null ? views : Math.min(views, limit)
  const path = cell(values, mapping, 'path') ?? '/'
  const siteLocation = new URL(path.startsWith('/') ? path : `/${path}`, origin).href
  const spacing = day / (count + 1)

  const shared = {
    domainId,
    siteLocation,
    siteReferrer: readReferrer(cell(values, mapping, 'referrer')),
    country: readCountry(cell(values, mapping, 'country')),
    browserName: cell(values, mapping, 'browser'),
    osName: cell(values, mapping, 'os'),
    deviceName: cell(values, mapping, 'device'),
  }

  return Array.from({ length: count }, (_, index) => {
    const created = new Date(date.getTime() + spacing * (index + 1))

    return {
      ...shared,
      // No visitor hash: an aggregate row cannot say who the visits belonged to, and
      // inventing one would make unique views look real when they are not.
      created,
      updated: created,
    }
  })
}

// Reads the file line by line rather than at once: an export of a busy year is large, and
// there is no reason to hold it all in memory.
export const readRows = async function* (file) {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY })
  let mapping = null

  for await (const line of lines) {
    if (line.trim() === '') continue

    if (mapping == null) {
      mapping = readHeader(line)
      continue
    }

    yield { values: splitRow(line), mapping }
  }
}
