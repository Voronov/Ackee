import test from 'ava'
import { startOfDay } from 'date-fns'
import listen from 'test-listen'

import { DURATIONS_LIMIT } from '../../src/constants/durations.js'
import { rollUp, sealedUntil } from '../../src/database/rollups.js'
import * as users from '../../src/database/users.js'
import DimensionRollup from '../../src/models/DimensionRollup.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import RollupState from '../../src/models/RollupState.js'
import Token from '../../src/models/Token.js'
import ViewRollup from '../../src/models/ViewRollup.js'
import server from '../../src/server.js'
import { day, hour, minute, second } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// The same records on every run: the reports compared below must not depend on luck
const random = (() => {
  let seed = 42
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return seed / 2 ** 31
  }
})()

const pick = (values) => values[Math.floor(random() * values.length)]

// A day on which no visit is short enough to count for the durations report
const longVisitsOnly = startOfDay(Date.now()).getTime() - 12 * day

const record = (domainId, created) => {
  const width = pick([414, 1280, 1920, null])
  const isLongVisitsOnly = created >= longVisitsOnly && created < longVisitsOnly + day
  const duration = isLongVisitsOnly
    ? 2 * hour
    : pick([0, 5 * second, 20 * second, 10 * minute, DURATIONS_LIMIT - 1, DURATIONS_LIMIT, 2 * hour])

  return {
    domainId,
    // Undefined leaves the field out, as the tracker does without a clientId
    clientId: pick([`client-${Math.floor(random() * 50)}`, null, undefined]),
    siteLocation: pick(['https://example.com/', 'https://example.com/about']),
    siteReferrer: pick(['https://google.com/', 'https://news.ycombinator.com/', null]),
    source: pick(['Newsletter', null, null]),
    screenWidth: width,
    screenHeight: width == null ? null : width / 2,
    browserWidth: width,
    browserHeight: width == null ? null : width / 3,
    deviceName: pick(['iPhone', 'Pixel', null]),
    deviceManufacturer: pick(['Apple', 'Google', null]),
    osName: pick(['iOS', 'Android', null]),
    osVersion: pick(['14.0', '13.0', null]),
    browserName: pick(['Safari', 'Chrome', 'Firefox', null]),
    browserVersion: pick(['14.0', '13.0', null]),
    created: new Date(created),
    updated: new Date(created + duration),
  }
}

// Records on both sides of every place where a report switches between rollups and records:
// the start of each window, the first whole hour after it and the end of the rollups.
const edges = (now) => {
  const starts = [now - 24 * hour, now - 7 * day, now - 30 * day, startOfDay(now).getTime() - 29 * day - 14 * hour]
  const seal = sealedUntil(new Date(now)).getTime()

  return [
    ...starts.flatMap((start) => {
      const hourStart = Math.floor(start / hour) * hour
      return [start - 2 * minute, start + 2 * minute, hourStart + minute, hourStart + hour - minute]
    }),
    seal - 1,
    seal,
    seal + 1,
    now - minute,
  ]
}

const views = (type, interval) => `views(type: ${type}, interval: ${interval}, limit: 30) { id value count }`
const durations = (interval) => `durations(interval: ${interval}, limit: 30) { id value count }`
const top = (report, type, range, limit = 100) =>
  `${report}(sorting: TOP, type: ${type}, range: ${range}, limit: ${limit}) { id value count }`

const ranges = ['LAST_24_HOURS', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_6_MONTHS']

const reports = [
  ...['TOTAL', 'UNIQUE'].flatMap((type) => ['DAILY', 'MONTHLY', 'YEARLY'].map((interval) => views(type, interval))),
  ...['DAILY', 'MONTHLY'].map((interval) => durations(interval)),
  ...ranges.flatMap((range) =>
    ['WITH_SOURCE', 'NO_SOURCE', 'ONLY_SOURCE'].map((type) => top('referrers', type, range)),
  ),
  ...['NO_VERSION', 'WITH_VERSION'].map((type) => top('browsers', type, 'LAST_30_DAYS')),
  ...['NO_VERSION', 'WITH_VERSION'].map((type) => top('systems', type, 'LAST_30_DAYS')),
  ...['NO_MODEL', 'WITH_MODEL'].map((type) => top('devices', type, 'LAST_30_DAYS')),
  ...[
    'BROWSER_WIDTH',
    'BROWSER_HEIGHT',
    'BROWSER_RESOLUTION',
    'SCREEN_WIDTH',
    'SCREEN_HEIGHT',
    'SCREEN_RESOLUTION',
  ].map((type) => top('sizes', type, 'LAST_30_DAYS')),
  // A limit that cuts through entries with the same count
  top('browsers', 'WITH_VERSION', 'LAST_30_DAYS', 3),
  top('referrers', 'WITH_SOURCE', 'LAST_7_DAYS', 1),
]

// Kolkata is half an hour off UTC, so its days split hours and the reports read records
const timeZones = ['UTC', 'Europe/Kyiv', 'America/New_York', 'Asia/Kolkata']

const fetchReports = async (t, timeZone) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query fetchStatistics($id: ID!) {
          domain(id: $id) {
            statistics {
              ${reports.map((report, index) => `r${index}: ${report}`).join('\n')}
            }
          }
        }
      `,
      variables: { id: t.context.domain.id },
    },
    t.context.token.id,
    { 'Time-Zone': timeZone },
  )

  if (json.errors != null) throw new Error(json.errors[0].message)

  return json.data.domain.statistics
}

const fetchAll = async (t) =>
  Object.fromEntries(await Promise.all(timeZones.map(async (zone) => [zone, await fetchReports(t, zone)])))

// Reports as they were read from records only, before any rollup existed
let raw

const sum = (entries) => entries.reduce((total, entry) => total + entry.count, 0)

test.before(async (t) => {
  const { user, workspace } = await users.add({
    email: 'rollups@example.com',
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: 'Rollups',
  })
  const other = await users.add({
    email: 'other@example.com',
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: 'Other',
  })

  const domain = await Domain.create({ title: 'rollups.example.com', workspaceId: workspace.id })
  const otherDomain = await Domain.create({ title: 'other.example.com', workspaceId: other.workspace.id })

  const now = Date.now()
  const times = [...Array.from({ length: 1500 }, () => now - Math.floor(random() * 200 * day)), ...edges(now)]

  await Record.insertMany(times.map((time) => record(domain.id, time)))
  // Another domain's records end up in the same hours of the rollups, but never in this report
  await Record.insertMany(times.slice(0, 300).map((time) => record(otherDomain.id, time)))

  Object.assign(t.context, {
    domain,
    otherDomain,
    token: await Token.create({ userId: user.id }),
  })
})

test.serial('reports read records while there are no rollups', async (t) => {
  t.is(await RollupState.findById('records'), null)

  raw = await fetchAll(t)

  t.true(sum(raw.UTC.r0) > 0)
})

test.serial('rollups cover every sealed hour since the oldest record', async (t) => {
  const now = new Date()
  const state = await rollUp(now)
  const oldest = await Record.findOne().sort({ created: 1 }).lean()

  t.true(state.from <= oldest.created)
  t.deepEqual(state.until, sealedUntil(now))
  t.true((await ViewRollup.countDocuments()) > 0)
  t.true((await DimensionRollup.countDocuments({ dimension: 'referrers' })) > 0)
})

test.serial('numbers from rollups equal the numbers from records', async (t) => {
  const rolled = await fetchAll(t)

  for (const zone of timeZones) {
    for (const [index, report] of reports.entries()) {
      t.deepEqual(rolled[zone][`r${index}`], raw[zone][`r${index}`], `${zone}: ${report}`)
    }
  }
})

test.serial('building again changes nothing', async (t) => {
  const counts = [await ViewRollup.countDocuments(), await DimensionRollup.countDocuments()]

  // Pretend the last two days were never built
  const state = await RollupState.findById('records')
  await RollupState.updateOne({ _id: 'records' }, { $set: { until: new Date(state.until.getTime() - 2 * day) } })
  await rollUp()

  t.deepEqual([await ViewRollup.countDocuments(), await DimensionRollup.countDocuments()], counts)
  t.deepEqual(await fetchReports(t, 'UTC'), raw.UTC)
})

test.serial('only one process builds at a time', async (t) => {
  await RollupState.updateOne({ _id: 'records' }, { $set: { lockedUntil: new Date(Date.now() + minute) } })
  t.is(await rollUp(), undefined)

  // The lease of a process that died runs out
  await RollupState.updateOne({ _id: 'records' }, { $set: { lockedUntil: new Date(Date.now() - minute) } })
  t.not(await rollUp(), undefined)
})

// A rollup that disagrees with its records shows which of the two a report has read
const inflate = (domainId, count) =>
  ViewRollup.updateOne(
    { domainId, hour: { $gte: new Date(Date.now() - 20 * day), $lt: new Date(Date.now() - 2 * day) } },
    { $inc: { total: count } },
  )

test.serial('reports take the covered hours from the rollups', async (t) => {
  t.is((await inflate(t.context.domain.id, 1000)).modifiedCount, 1)

  t.is(sum((await fetchReports(t, 'UTC')).r0), sum(raw.UTC.r0) + 1000)
  // A half-hour zone cannot sum hours into days, so it reads records and misses the inflated hour
  t.is(sum((await fetchReports(t, 'Asia/Kolkata')).r0), sum(raw['Asia/Kolkata'].r0))
})

test.serial('reports fall back to records without rollups', async (t) => {
  await RollupState.deleteOne({ _id: 'records' })

  t.deepEqual(await fetchReports(t, 'UTC'), raw.UTC)
})

// Imported history lands before the first rollup, and the reports read it from records
test.serial('records older than the rollups still count', async (t) => {
  const { from } = await rollUp()
  const yearly = async () => sum((await fetchReports(t, 'UTC')).r2)
  const before = await yearly()

  await Record.insertMany([record(t.context.domain.id, from.getTime() - hour)])

  t.is(await yearly(), before + 1)
})

test.serial('deleting a domain deletes its rollups', async (t) => {
  await Record.insertMany([record(t.context.domain.id, Date.now() - 3 * day)])
  await rollUp()

  t.true((await ViewRollup.countDocuments({ domainId: t.context.domain.id })) > 0)

  const { json } = await api(
    base,
    {
      query: gql`
        mutation deleteDomain($id: ID!) {
          deleteDomain(id: $id) {
            success
          }
        }
      `,
      variables: { id: t.context.domain.id },
    },
    t.context.token.id,
  )

  t.true(json.data.deleteDomain.success)
  t.is(await ViewRollup.countDocuments({ domainId: t.context.domain.id }), 0)
  t.is(await DimensionRollup.countDocuments({ domainId: t.context.domain.id }), 0)
  t.true((await ViewRollup.countDocuments({ domainId: t.context.otherDomain.id })) > 0)
})

test('hours are sealed only after the visits in them are over', (t) => {
  const now = new Date('2026-10-19T00:20:00')

  // The visits of 23:00–23:59 may still go on until 00:30
  t.deepEqual(sealedUntil(now), new Date('2026-10-18T23:00:00'))
})

test('hours of the current day are sealed only after the salt changed', (t) => {
  const now = new Date('2026-10-19T00:40:00')

  // A visit at 23:50 is over by now and the salt of the 19th anonymizes nothing of the 18th
  t.deepEqual(sealedUntil(now), new Date('2026-10-19T00:00:00'))
  t.deepEqual(sealedUntil(new Date('2026-10-19T18:00:00')), startOfDay(now))
})
