import mongoose from 'mongoose'
import crypto from 'node:crypto'
import path from 'node:path'
import { parseArgs } from 'node:util'

import Domain from '../src/models/Domain.js'
import Workspace from '../src/models/Workspace.js'
import Record from '../src/models/Record.js'
import config from '../src/utils/config.js'
import connect from '../src/utils/connect.js'
import signale from '../src/utils/signale.js'
import { day, minute } from '../src/utils/times.js'

// Matches the LR-1 benchmark profile: 10M records from 200k visitors
const visitorsRatio = 0.02
const referrerRatio = 0.55
const updatedRatio = 0.4
const maxDuration = 30 * minute

const pagesCount = 300
const referrersCount = 150

const browsers = [
  { browserName: 'Chrome', browserVersion: '129.0' },
  { browserName: 'Chrome', browserVersion: '128.0' },
  { browserName: 'Safari', browserVersion: '17.6' },
  { browserName: 'Safari', browserVersion: '18.0' },
  { browserName: 'Firefox', browserVersion: '130.0' },
  { browserName: 'Edge', browserVersion: '129.0' },
  { browserName: 'Samsung Internet', browserVersion: '26.0' },
]

const systems = [
  { osName: 'Windows', osVersion: '10' },
  { osName: 'Windows', osVersion: '11' },
  { osName: 'macOS', osVersion: '14.6' },
  { osName: 'iOS', osVersion: '17.6' },
  { osName: 'Android', osVersion: '14' },
  { osName: 'Linux', osVersion: undefined },
]

const devices = [
  { deviceName: undefined, deviceManufacturer: undefined },
  { deviceName: 'iPhone', deviceManufacturer: 'Apple' },
  { deviceName: 'iPad', deviceManufacturer: 'Apple' },
  { deviceName: 'Macintosh', deviceManufacturer: 'Apple' },
  { deviceName: 'Pixel 8', deviceManufacturer: 'Google' },
  { deviceName: 'Galaxy S24', deviceManufacturer: 'Samsung' },
]

const languages = ['en', 'de', 'uk', 'fr', 'es', 'pl', 'it', 'ja']

const screens = [
  { screenWidth: 1920, screenHeight: 1080, browserWidth: 1920, browserHeight: 969 },
  { screenWidth: 1440, screenHeight: 900, browserWidth: 1440, browserHeight: 789 },
  { screenWidth: 1536, screenHeight: 864, browserWidth: 1536, browserHeight: 746 },
  { screenWidth: 2560, screenHeight: 1440, browserWidth: 2560, browserHeight: 1329 },
  { screenWidth: 390, screenHeight: 844, browserWidth: 390, browserHeight: 664 },
  { screenWidth: 414, screenHeight: 896, browserWidth: 414, browserHeight: 719 },
  { screenWidth: 360, screenHeight: 800, browserWidth: 360, browserHeight: 700 },
  { screenWidth: 1024, screenHeight: 1366, browserWidth: 1024, browserHeight: 1292 },
]

const colorDepths = [24, 24, 24, 30, 32]

const sources = [undefined, undefined, undefined, undefined, 'Newsletter', 'Twitter', 'Product Hunt']

const knownReferrers = [
  'https://google.com/',
  'https://duckduckgo.com/',
  'https://bing.com/',
  'https://news.ycombinator.com/',
  'https://twitter.com/',
  'https://github.com/',
  'https://reddit.com/',
]

// Small, fast and deterministic PRNG (mulberry32). Math.random can't be seeded.
const createRandom = (seed) => {
  let state = seed >>> 0

  return () => {
    state = (state + 1831565813) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic UUID v4 built from the PRNG instead of crypto.randomUUID
const createUuid = (random) => {
  const bytes = Buffer.alloc(16)
  for (let index = 0; index < 16; index++) bytes[index] = Math.floor(random() * 256)
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Picks from a list with a bias towards the first items (skew > 1 = heavier head).
// Gives the usual "few popular pages, long tail" shape.
const pick = (random, list, skew = 1) => list[Math.floor(list.length * random() ** skew)]

const pages = Array.from({ length: pagesCount }, (_, index) =>
  index === 0 ? 'https://example.com/' : `https://example.com/page-${index}/`,
)

const referrers = [
  ...knownReferrers,
  ...Array.from({ length: referrersCount - knownReferrers.length }, (_, index) => `https://referrer-${index}.com/`),
]

const clientId = (seed, index) => crypto.createHash('sha256').update(`${seed}:${index}`).digest('hex')

// Record ids are unique across the collection, so the same seed has to
// produce different ids for every domain seeded into the same database
const createSeed = (seed, domainId) =>
  crypto.createHash('sha256').update(`${seed}:${domainId}`).digest().readUInt32BE(0)

// The tracker leaves optional fields out of the document, but `insertMany`
// with `lean: true` would store `undefined` as an explicit `null`
const withoutUndefined = (record) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))

export const defaults = {
  records: 100000,
  days: 60,
  seed: 42,
  batch: 5000,
}

export const summarize = ({ records, days, now = Date.now() }) => ({
  records,
  days,
  visitors: Math.max(1, Math.round(records * visitorsRatio)),
  pages: pagesCount,
  referrers: referrersCount,
  browsers: browsers.length,
  systems: systems.length,
  devices: devices.length,
  languages: languages.length,
  sizes: screens.length,
  from: new Date(now - days * day),
  to: new Date(now),
})

export const generateRecords = function* ({ records, days, domainId, seed = defaults.seed, now = Date.now() }) {
  const random = createRandom(createSeed(seed, domainId))
  const { visitors } = summarize({ records, days, now })
  const range = days * day

  for (let index = 0; index < records; index++) {
    const created = new Date(now - Math.floor(random() * range))
    const updated = random() < updatedRatio ? new Date(created.getTime() + Math.floor(random() * maxDuration)) : created
    const siteReferrer = random() < referrerRatio ? pick(random, referrers, 2) : undefined

    yield withoutUndefined({
      id: createUuid(random),
      clientId: clientId(seed, Math.floor(random() * visitors)),
      domainId,
      siteLocation: pick(random, pages, 3),
      siteReferrer,
      siteLanguage: pick(random, languages, 2),
      source: pick(random, sources),
      screenColorDepth: pick(random, colorDepths),
      ...pick(random, screens, 1.5),
      ...pick(random, devices, 1.5),
      ...pick(random, systems, 1.5),
      ...pick(random, browsers, 1.5),
      created,
      updated,
    })
  }
}

export const parseOptions = (args) => {
  const { values } = parseArgs({
    args,
    options: {
      'records': { type: 'string', default: String(defaults.records) },
      'days': { type: 'string', default: String(defaults.days) },
      'domain': { type: 'string' },
      'seed': { type: 'string', default: String(defaults.seed) },
      'batch': { type: 'string', default: String(defaults.batch) },
      'now': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const toInteger = (name) => {
    const value = values[name]
    if (/^\d+$/.test(value) === false || Number(value) < 1) {
      throw new Error(`Option --${name} must be a positive integer`)
    }
    return Number(value)
  }

  const now = values.now == null ? Date.now() : new Date(values.now).getTime()
  if (Number.isNaN(now)) throw new Error('Option --now must be a valid date')

  return {
    records: toInteger('records'),
    days: toInteger('days'),
    seed: toInteger('seed'),
    batch: toInteger('batch'),
    domainId: values.domain,
    dryRun: values['dry-run'],
    now,
  }
}

const resolveDomainId = async (options) => {
  if (options.domainId == null) {
    // Domains belong to a workspace, so seeding into a fresh instance needs one
    const workspace = await Workspace.create({ title: 'Seed' })
    const domain = await Domain.create({ title: `Seed ${options.records} records`, workspaceId: workspace.id })

    signale.success(`Created domain ${domain.id} (${domain.title}) in workspace ${workspace.id}`)

    return domain.id
  }

  const domain = await Domain.findOne({ id: options.domainId })
  if (domain == null) throw new Error(`Domain ${options.domainId} not found`)
  return domain.id
}

export const run = async (options) => {
  const summary = summarize(options)

  signale.info(
    `Generating ${summary.records} records over ${summary.days} days (${summary.from.toISOString()} – ${summary.to.toISOString()})`,
  )
  signale.info(
    `${summary.visitors} visitors, ${summary.pages} pages, ${summary.referrers} referrers, ${summary.browsers} browsers, ${summary.systems} systems, ${summary.devices} devices, ${summary.languages} languages, ${summary.sizes} sizes, seed ${options.seed}`,
  )

  if (options.dryRun === true) {
    signale.info(`Dry run: ${Math.ceil(options.records / options.batch)} batches of ${options.batch} would be inserted`)
    return
  }

  const domainId = await resolveDomainId(options)

  let batch = []
  let inserted = 0

  const flush = async () => {
    if (batch.length === 0) return
    // Records are trusted, skip Mongoose casting and validation for speed
    await Record.insertMany(batch, { ordered: false, lean: true })
    inserted += batch.length
    batch = []
    signale.await(`Inserted ${inserted}/${options.records}`)
  }

  for (const record of generateRecords({ ...options, domainId })) {
    batch.push(record)
    if (batch.length >= options.batch) await flush()
  }

  await flush()

  signale.success(`Inserted ${inserted} records into domain ${domainId}`)
}

const parseOrExit = (args) => {
  try {
    return parseOptions(args)
  } catch (error) {
    signale.fatal(error.message)
    process.exit(1)
  }
}

const main = async () => {
  const options = parseOrExit(process.argv.slice(2))

  if (options.dryRun === false) {
    if (config.dbUrl == null) throw new Error('MongoDB connection URI missing in environment')
    await connect(config.dbUrl)
  }

  await run(options)
  await mongoose.disconnect()
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename

if (isMain === true) {
  main().catch((error) => {
    signale.fatal(error)
    process.exit(1)
  })
}
