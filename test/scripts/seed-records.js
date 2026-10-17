import test from 'ava'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { randomUUID as uuid } from 'node:crypto'

import { clientId, defaults, generateRecords, parseOptions, run, summarize } from '../../scripts/seed-records.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import connect from '../../src/utils/connect.js'
import { day, minute } from '../../src/utils/times.js'

const mongoDb = MongoMemoryServer.create()

const now = Date.parse('2026-09-21T12:00:00.000Z')

const generate = (options) => [...generateRecords({ records: 1000, days: 60, domainId: 'domain', now, ...options })]

const seed = (options) => run({ records: 50, days: 3, seed: 42, batch: 20, now, dryRun: false, ...options })

test.before(async () => {
  await connect((await mongoDb).getUri())
})

test.after.always(async () => {
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

test.afterEach.always(async () => {
  await Record.deleteMany({})
  await Domain.deleteMany({})
})

test('generates the requested amount of records', (t) => {
  t.is(generate({ records: 1 }).length, 1)
  t.is(generate({ records: 1000 }).length, 1000)
})

test('generates the same records for the same seed', (t) => {
  const first = generate({ seed: 42 }).slice(0, 10)
  const second = generate({ seed: 42 }).slice(0, 10)

  t.deepEqual(first, second)
})

test('generates different records for a different seed', (t) => {
  const first = generate({ seed: 42 }).slice(0, 10)
  const second = generate({ seed: 43 }).slice(0, 10)

  t.notDeepEqual(first, second)
})

test('generates different records for the same seed in a different domain', (t) => {
  const first = generate({ seed: 42, domainId: 'first' }).slice(0, 10)
  const second = generate({ seed: 42, domainId: 'second' }).slice(0, 10)

  t.notDeepEqual(
    first.map((record) => record.id),
    second.map((record) => record.id),
  )
})

test('generates records within the date range', (t) => {
  const days = 7
  const from = now - days * day

  const records = generate({ days })

  t.true(records.every((record) => record.created.getTime() >= from && record.created.getTime() <= now))
  t.true(records.some((record) => record.created.getTime() < now - (days - 1) * day))
})

test('generates updated between created and created plus 30 minutes', (t) => {
  const records = generate({})

  t.true(
    records.every((record) => {
      const duration = record.updated.getTime() - record.created.getTime()
      return duration >= 0 && duration <= 30 * minute
    }),
  )
  t.true(records.some((record) => record.updated.getTime() > record.created.getTime()))
  t.true(records.some((record) => record.updated.getTime() === record.created.getTime()))
})

test('generates records for the given domain with unique ids', (t) => {
  const domainId = uuid()
  const records = generate({ domainId })

  t.true(records.every((record) => record.domainId === domainId))
  t.is(new Set(records.map((record) => record.id)).size, records.length)
})

test('generates a realistic distribution of values', (t) => {
  const records = generate({ records: 10000 })
  // Visitor fields survive only in the last record of every visitor per day
  const kept = records.filter((record) => record.clientId != null)
  const distinct = (list, key) => new Set(list.map((record) => record[key])).size

  t.true(distinct(records, 'siteLocation') > 100)
  t.true(distinct(records, 'siteReferrer') > 50)
  t.true(records.some((record) => record.siteReferrer == null))
  t.true(records.some((record) => record.siteReferrer != null))
  t.true(distinct(kept, 'browserName') >= 3)
  t.true(distinct(kept, 'osName') >= 3)
  t.true(distinct(kept, 'siteLanguage') >= 3)
  t.true(distinct(kept, 'screenWidth') >= 3)
  // Most visitors come back on several days and get a clientId for each of them
  t.true(kept.length > summarize({ records: 10000, days: 60, now }).visitors)
  t.true(kept.length < records.length)
})

test('generates records in the order of creation', (t) => {
  const records = generate({})

  t.true(records.every((record, index) => index === 0 || record.created >= records[index - 1].created))
})

test('spreads records evenly over the range', (t) => {
  const days = 10
  const records = generate({ records: 10000, days })
  const perDay = Array.from({ length: days }, (_, index) => {
    const from = now - (days - index) * day
    return records.filter((record) => record.created.getTime() >= from && record.created.getTime() < from + day).length
  })

  t.true(perDay.every((count) => count === 1000))
})

test('keeps visitor fields only in the last record of every visitor per day', (t) => {
  const records = generate({ records: 5000 })
  const kept = records.filter((record) => record.clientId != null)
  const anonymized = records.filter((record) => record.clientId == null)

  t.is(new Set(kept.map((record) => record.clientId)).size, kept.length)
  t.true(kept.every((record) => record.browserName != null && record.siteLanguage != null))
  t.true(anonymized.length > 0)
  t.true(
    anonymized.every((record) =>
      [
        'clientId',
        'siteLanguage',
        'screenWidth',
        'screenHeight',
        'screenColorDepth',
        'deviceName',
        'deviceManufacturer',
        'osName',
        'osVersion',
        'browserName',
        'browserVersion',
        'browserWidth',
        'browserHeight',
      ].every((field) => record[field] === null),
    ),
  )
  // Fields the tracker never anonymizes stay in every record
  t.true(records.every((record) => record.siteLocation != null && record.domainId === 'domain'))
})

test('gives the same visitor another clientId every day', (t) => {
  t.is(clientId(42, 7, 20000, 'a'), clientId(42, 7, 20000, 'a'))
  t.not(clientId(42, 7, 20000, 'a'), clientId(42, 7, 20001, 'a'))
  t.not(clientId(42, 7, 20000, 'a'), clientId(42, 8, 20000, 'a'))
})

test('gives the same visitor another clientId on every domain', (t) => {
  t.not(clientId(42, 7, 20000, 'a'), clientId(42, 7, 20000, 'b'))
})

test('anonymizes a visitor within one day only', (t) => {
  // 50 records give a single visitor, spread over the days of the range
  const records = generate({ records: 50, days: 3 })
  const utcDay = (record) => Math.floor(record.created.getTime() / day)
  const days = [...new Set(records.map(utcDay))]
  const kept = records.filter((record) => record.clientId != null)

  t.is(summarize({ records: 50, days: 3, now }).visitors, 1)
  t.true(days.length > 1)
  t.deepEqual(kept.map(utcDay), days)
  t.is(new Set(kept.map((record) => record.clientId)).size, days.length)
  t.true(kept.every((record) => record === records.findLast((other) => utcDay(other) === utcDay(record))))
})

test('keeps the visitor fields of the newest record', (t) => {
  t.not(generate({ records: 1 })[0].clientId, null)
  t.not(generate({ records: 1000 }).at(-1).clientId, null)
})

test('leaves optional fields out instead of setting them to undefined', (t) => {
  const records = generate({})

  t.true(records.every((record) => Object.values(record).every((value) => value !== undefined)))
  t.true(records.some((record) => Object.hasOwn(record, 'siteReferrer') === false))
  t.true(records.some((record) => Object.hasOwn(record, 'siteReferrer') === true))
})

test('generates records that pass the schema validation', async (t) => {
  const records = generate({ records: 200 })

  for (const record of records) {
    await t.notThrowsAsync(new Record(record).validate())
  }
})

test('summarizes what would be generated', (t) => {
  const summary = summarize({ records: 100000, days: 60, now })

  t.is(summary.records, 100000)
  t.is(summary.days, 60)
  t.is(summary.visitors, 2000)
  t.is(summary.from.getTime(), now - 60 * day)
  t.is(summary.to.getTime(), now)
})

test('parses options with defaults', (t) => {
  const options = parseOptions([])

  t.is(options.records, defaults.records)
  t.is(options.days, defaults.days)
  t.is(options.seed, defaults.seed)
  t.is(options.batch, defaults.batch)
  t.is(options.domainId, undefined)
  t.false(options.dryRun)
})

test('parses options from arguments', (t) => {
  const options = parseOptions([
    '--records',
    '500',
    '--days',
    '3',
    '--seed',
    '7',
    '--domain',
    'domain',
    '--now',
    '2026-09-21T12:00:00.000Z',
    '--dry-run',
  ])

  t.is(options.records, 500)
  t.is(options.days, 3)
  t.is(options.seed, 7)
  t.is(options.domainId, 'domain')
  t.is(options.now, now)
  t.true(options.dryRun)
})

test('rejects invalid options', (t) => {
  t.throws(() => parseOptions(['--records', '0']), { message: 'Option --records must be a positive integer' })
  t.throws(() => parseOptions(['--days', 'abc']), { message: 'Option --days must be a positive integer' })
  t.throws(() => parseOptions(['--records', '10abc']), { message: 'Option --records must be a positive integer' })
  t.throws(() => parseOptions(['--now', 'yesterday']), { message: 'Option --now must be a valid date' })
})

test.serial('inserts the requested amount of records into a new domain', async (t) => {
  await seed({})

  const domains = await Domain.find({})
  t.is(domains.length, 1)
  t.is(domains[0].title, 'Seed 50 records')
  t.is(await Record.countDocuments(), 50)
  t.is(await Record.countDocuments({ domainId: domains[0].id }), 50)
})

test.serial('inserts into an existing domain', async (t) => {
  const domain = await Domain.create({ title: 'Existing' })

  await seed({ domainId: domain.id })

  t.is(await Domain.countDocuments(), 1)
  t.is(await Record.countDocuments({ domainId: domain.id }), 50)
})

test.serial('fails when the given domain does not exist', async (t) => {
  await t.throwsAsync(seed({ domainId: 'missing' }), { message: 'Domain missing not found' })

  t.is(await Record.countDocuments(), 0)
})

test.serial('does not touch the database on a dry run', async (t) => {
  await seed({ dryRun: true })

  t.is(await Domain.countDocuments(), 0)
  t.is(await Record.countDocuments(), 0)
})

test.serial('stores anonymized records the same way as the tracker', async (t) => {
  await seed({ records: 200 })

  t.true((await Record.countDocuments({ clientId: null, browserName: { $type: 'null' } })) > 0)
  const visitors = await Record.distinct('clientId', { clientId: { $ne: null } })
  t.is(await Record.countDocuments({ clientId: { $ne: null } }), visitors.length)
})

test.serial('stores missing optional fields the same way as the tracker', async (t) => {
  await seed({ records: 200 })

  t.is(await Record.countDocuments({ siteReferrer: { $type: 'null' } }), 0)
  t.true((await Record.countDocuments({ siteReferrer: { $exists: false } })) > 0)
  t.true((await Record.countDocuments({ siteReferrer: { $exists: true } })) > 0)
})

test.serial('inserts records that match the generator output', async (t) => {
  await seed({})

  const domain = await Domain.findOne({})
  const expected = [...generateRecords({ records: 50, days: 3, seed: 42, now, domainId: domain.id })]
  const stored = await Record.find({}, { _id: 0, __v: 0 }).sort({ _id: 1 }).lean()

  t.deepEqual(stored, expected)
})
