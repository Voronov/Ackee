import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

import { add, anonymize, anonymizeByIds, update, validate } from '../../src/database/records.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import connect from '../../src/utils/connect.js'

const mongoDb = MongoMemoryServer.create()

const anonymizedFields = [
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
]

const record = (clientId, domainId) => ({
  clientId,
  domainId,
  siteLocation: 'https://example.com/',
  siteReferrer: 'https://google.com/',
  siteLanguage: 'en',
  source: 'Newsletter',
  screenWidth: 414,
  screenHeight: 896,
  screenColorDepth: 32,
  deviceName: 'iPhone',
  deviceManufacturer: 'Apple',
  osName: 'iOS',
  osVersion: '14.0',
  browserName: 'Safari',
  browserVersion: '14.0',
  browserWidth: 414,
  browserHeight: 719,
})

const assertAnonymized = (t, entry) => {
  for (const field of anonymizedFields) t.is(entry[field], null, field)

  t.is(entry.siteLocation, 'https://example.com/')
  t.is(entry.siteReferrer, 'https://google.com/')
  t.is(entry.source, 'Newsletter')
}

const assertIntact = (t, entry, clientId) => {
  const expected = record(clientId, entry.domainId)

  for (const field of Object.keys(expected)) t.is(entry[field], expected[field], field)
}

test.before(async () => {
  await connect((await mongoDb).getUri())
})

test.after.always(async () => {
  await mongoose.disconnect()
  await (await mongoDb).stop()
})

test.beforeEach(async (t) => {
  const domain = await Domain.create({ title: 'Example', workspaceId: uuid() })
  const clientId = `client-${domain.id}`

  t.context.clientId = clientId
  t.context.records = await Record.insertMany([
    record(clientId, domain.id),
    record(clientId, domain.id),
    record(clientId, domain.id),
  ])
})

test.serial('anonymize nulls every record of the visitor except the ignored one', async (t) => {
  const [first, second, third] = t.context.records

  await anonymize(t.context.clientId, third.id)

  assertAnonymized(t, await Record.findOne({ id: first.id }).lean())
  assertAnonymized(t, await Record.findOne({ id: second.id }).lean())
  assertIntact(t, await Record.findOne({ id: third.id }).lean(), t.context.clientId)
})

test.serial('anonymizeByIds nulls the same fields but only on the given records', async (t) => {
  const [first, second, third] = t.context.records

  await anonymizeByIds([first.id])

  assertAnonymized(t, await Record.findOne({ id: first.id }).lean())
  assertIntact(t, await Record.findOne({ id: second.id }).lean(), t.context.clientId)
  assertIntact(t, await Record.findOne({ id: third.id }).lean(), t.context.clientId)
})

test.serial('anonymizeByIds with no ids changes nothing', async (t) => {
  await anonymizeByIds([])

  for (const { id } of t.context.records) {
    assertIntact(t, await Record.findOne({ id }).lean(), t.context.clientId)
  }
})

test.serial('validate returns the response shape with a generated id and dates without saving', async (t) => {
  const [first] = t.context.records
  const entry = await validate(record(t.context.clientId, first.domainId))

  t.is(typeof entry.id, 'string')
  t.is(entry.id.length, 36)
  t.true(entry.created instanceof Date)
  t.true(entry.updated instanceof Date)
  t.is(entry.siteLocation, 'https://example.com/')
  t.is(entry.browserName, 'Safari')
  t.is(entry.clientId, undefined)
  t.is(await Record.countDocuments({ id: entry.id }), 0)
})

test.serial('validate throws the same ValidationError as add', async (t) => {
  const [first] = t.context.records
  const invalid = { ...record(t.context.clientId, first.domainId), siteLocation: 'not a url' }

  const fromValidate = await t.throwsAsync(() => validate(invalid))
  const fromAdd = await t.throwsAsync(() => add(invalid))

  t.is(fromValidate.name, 'ValidationError')
  t.is(fromAdd.name, 'ValidationError')
  t.deepEqual(Object.keys(fromValidate.errors), Object.keys(fromAdd.errors))
  t.is(fromValidate.errors.siteLocation.message, fromAdd.errors.siteLocation.message)
})

test.serial('add keeps a given id, created and updated and generates them otherwise', async (t) => {
  const [first] = t.context.records
  const created = new Date('2026-01-02T03:04:05.678Z')
  const updated = new Date('2026-01-02T03:05:05.678Z')

  const given = await add({ ...record(t.context.clientId, first.domainId), id: 'given-id', created, updated })
  const generated = await add(record(t.context.clientId, first.domainId))

  t.is(given.id, 'given-id')
  t.is(given.created.getTime(), created.getTime())
  t.is(given.updated.getTime(), updated.getTime())
  t.is(generated.id.length, 36)
  t.true(Date.now() - generated.created.getTime() < 5000)

  const stored = await Record.findOne({ id: 'given-id' }).lean()
  t.is(stored.created.getTime(), created.getTime())
  t.is(stored.updated.getTime(), updated.getTime())
})

test.serial('add rejects a second record with the same id', async (t) => {
  const [first] = t.context.records
  const error = await t.throwsAsync(() => add({ ...record(t.context.clientId, first.domainId), id: first.id }))

  t.is(error.code, 11000)
})

test.serial('update sets updated to the given time or to now and never moves it backwards', async (t) => {
  const [first, second] = t.context.records
  const later = Date.now() + 60_000
  const earlier = later - 30_000

  const given = await update(first.id, later)
  const replayed = await update(first.id, earlier)
  const now = await update(second.id)

  t.is(given.updated.getTime(), later)
  t.is(replayed.updated.getTime(), later)
  t.is((await Record.findOne({ id: first.id }).lean()).updated.getTime(), later)
  t.true(Date.now() - now.updated.getTime() < 5000)
  t.true(now.updated.getTime() >= second.updated.getTime())
  t.is(await update('unknown-id'), null)
})
