import mongoose from 'mongoose'
import path from 'node:path'
import { parseArgs } from 'node:util'

import Ga4Connection from '../src/models/Ga4Connection.js'
import Ga4Daily from '../src/models/Ga4Daily.js'
import Record from '../src/models/Record.js'
import config from '../src/utils/config.js'
import connect from '../src/utils/connect.js'
import { seal } from '../src/utils/secretBox.js'
import signale from '../src/utils/signale.js'

// GA counts fewer visits than Ackee: it needs consent and a script that blockers do not stop
const defaults = { factor: 0.82, spread: 0.1, seed: 1 }

// The Ackee field behind every GA4 dimension, and how its value is written in GA4
const field = (name, format = String) => ({ name, format })

const withoutScheme = (value) => value.replace(/^https?:\/\//, '')
const host = (value) => new URL(value).hostname.replace(/^www\./, '')

const dimensions = {
  pages: field('siteLocation', withoutScheme),
  referrers: field('siteReferrer', host),
  systems: field('osName'),
  devices: field('deviceManufacturer'),
  browsers: field('browserName'),
  languages: field('siteLanguage'),
}

// Mulberry32: the same seed gives the same numbers, so a rerun replaces the data with itself
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

export const parseOptions = (args) => {
  const { values } = parseArgs({
    args,
    options: {
      domain: { type: 'string' },
      factor: { type: 'string', default: String(defaults.factor) },
      seed: { type: 'string', default: String(defaults.seed) },
    },
  })

  if (values.domain == null) throw new Error('Option --domain is required')

  const factor = Number(values.factor)
  if (factor <= 0 || factor > 2 || Number.isNaN(factor)) throw new Error('Option --factor must be in (0, 2]')

  return { domainId: values.domain, factor, seed: Number(values.seed) }
}

const dateOf = { $dateToString: { format: '%Y-%m-%d', date: '$created', timezone: 'UTC' } }

// Views, visitors and time on site per day, straight from the records
const totals = (domainId) =>
  Record.aggregate([
    { $match: { domainId } },
    {
      $group: {
        _id: dateOf,
        views: { $sum: 1 },
        clients: { $addToSet: '$clientId' },
        seconds: { $sum: { $divide: [{ $subtract: ['$updated', '$created'] }, 1000] } },
      },
    },
    { $sort: { _id: 1 } },
  ])

const counts = (domainId, source) =>
  Record.aggregate([
    { $match: { domainId, [source]: { $nin: [null, ''] } } },
    { $group: { _id: { date: dateOf, value: `$${source}` }, views: { $sum: 1 } } },
  ])

// The placeholder property of this script, so a rerun is allowed and a real one is not touched
const DEMO_PROPERTY = '123456789'

export const run = async (options) => {
  const existing = await Ga4Connection.findOne({ domainId: options.domainId }).lean()
  if (existing != null && existing.propertyId !== DEMO_PROPERTY) {
    throw new Error(`Domain ${options.domainId} is connected to the real property ${existing.propertyId}`)
  }

  const random = createRandom(options.seed)
  // Around the factor, never the same on two days, so the two lines follow each other but do not match
  const scale = (value) => Math.round(value * options.factor * (1 + (random() * 2 - 1) * defaults.spread))
  const documents = []

  const days = await totals(options.domainId)
  if (days.length === 0) throw new Error(`Domain ${options.domainId} has no records`)

  for (const day of days) {
    const views = scale(day.views)
    const users = Math.max(1, Math.min(views, scale(day.clients.filter((id) => id != null).length || day.views * 0.4)))
    // A visitor opens a bit more than one session on a day
    const sessions = Math.max(users, Math.round(users * (1.1 + random() * 0.15)))
    const average = Math.max(20, Math.round(day.seconds / Math.max(day.views, 1)) + 35 + Math.round(random() * 40))

    documents.push({
      domainId: options.domainId,
      date: day._id,
      dimension: 'total',
      views,
      users,
      sessions,
      durationSum: average * sessions,
    })
  }

  for (const [key, { name, format }] of Object.entries(dimensions)) {
    for (const entry of await counts(options.domainId, name)) {
      let value
      try {
        value = format(entry._id.value)
      } catch {
        continue
      }

      documents.push({
        domainId: options.domainId,
        date: entry._id.date,
        dimension: key,
        value,
        views: Math.max(1, scale(entry.views)),
      })
    }
  }

  // Those GA4 dimensions that Ackee spells in two fields
  const withVersion = await Record.aggregate([
    { $match: { domainId: options.domainId, osName: { $nin: [null, ''] } } },
    { $group: { _id: { date: dateOf, name: '$osName', version: '$osVersion' }, views: { $sum: 1 } } },
  ])
  for (const entry of withVersion) {
    documents.push({
      domainId: options.domainId,
      date: entry._id.date,
      dimension: 'systemsWithVersion',
      value: [entry._id.name, entry._id.version].filter(Boolean).join(' '),
      views: Math.max(1, scale(entry.views)),
    })
  }

  const sizes = await Record.aggregate([
    { $match: { domainId: options.domainId, screenWidth: { $ne: null }, screenHeight: { $ne: null } } },
    { $group: { _id: { date: dateOf, width: '$screenWidth', height: '$screenHeight' }, views: { $sum: 1 } } },
  ])
  for (const entry of sizes) {
    documents.push({
      domainId: options.domainId,
      date: entry._id.date,
      dimension: 'sizes',
      value: `${entry._id.width}x${entry._id.height}`,
      views: Math.max(1, scale(entry.views)),
    })
  }

  const models = await Record.aggregate([
    { $match: { domainId: options.domainId, deviceName: { $nin: [null, ''] } } },
    { $group: { _id: { date: dateOf, name: '$deviceName' }, views: { $sum: 1 } } },
  ])
  for (const entry of models) {
    documents.push({
      domainId: options.domainId,
      date: entry._id.date,
      dimension: 'devicesWithModel',
      value: entry._id.name,
      views: Math.max(1, scale(entry.views)),
    })
  }

  await Ga4Daily.deleteMany({ domainId: options.domainId })
  await Ga4Daily.insertMany(documents, { ordered: false })

  // The connection is what makes the source switch appear. Its key is a placeholder: the next
  // sync fails at Google and says so in lastError, the seeded days stay (they are replaced only
  // by a sync that succeeds).
  const today = new Date().toISOString().slice(0, 10)
  await Ga4Connection.findOneAndUpdate(
    { domainId: options.domainId },
    {
      $set: {
        propertyId: DEMO_PROPERTY,
        clientEmail: 'ackee-demo@demo-project.iam.gserviceaccount.com',
        privateKey: seal('demo-placeholder'),
        firstDate: days[0]._id,
        lastDate: today,
        lastSync: new Date(),
        lockedUntil: null,
      },
      $unset: { lastError: 1 },
    },
    { upsert: true },
  )

  signale.success(
    `Seeded ${documents.length} GA4 rows over ${days.length} days for ${options.domainId} (factor ${options.factor})`,
  )
}

const main = async () => {
  const options = parseOptions(process.argv.slice(2))

  if (config.dbUrl == null) throw new Error('MongoDB connection URI missing in environment')
  await connect(config.dbUrl)
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
