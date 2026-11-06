import test from 'ava'
import { fromZonedTime } from 'date-fns-tz'
import listen from 'test-listen'

import { add as addAction, getChart } from '../../src/database/actions.js'
import getDurations from '../../src/database/durations.js'
import * as ga4 from '../../src/database/ga4.js'
import { rollUp } from '../../src/database/rollups.js'
import * as users from '../../src/database/users.js'
import getViews from '../../src/database/views.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import Ga4Daily from '../../src/models/Ga4Daily.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import createDate from '../../src/utils/createDate.js'
import { day } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// Kolkata is half an hour off UTC
const zones = ['UTC', 'Europe/Kyiv', 'America/New_York', 'Asia/Kolkata']

// Both windows hold the change of the clocks in Kyiv and in New York
const windows = {
  autumn: { from: '2026-10-20', to: '2026-11-03' },
  spring: { from: '2026-03-01', to: '2026-04-03' },
}

const shift = (date, days) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * day).toISOString().slice(0, 10)
const label = (date) => date.split('-').map(Number).join('-')
const daysOf = ({ from, to }) => {
  const days = [from]
  while (days.at(-1) !== to) days.push(shift(days.at(-1), 1))
  return days
}

const visit = (domainId, zone, date, time, fields = {}) => {
  const created = fromZonedTime(`${date}T${time}`, zone)
  const { duration = 30_000, ...rest } = fields

  return {
    clientId: 'a-visitor',
    domainId,
    siteLocation: 'https://example.com/',
    created,
    updated: new Date(created.getTime() + duration),
    ...rest,
  }
}

// The n-th day of a window has n views, from its first minutes to its last ones, and a visit lasts n * 30 seconds
const dayVisits = (domainId, zone, date, count) =>
  Array.from({ length: count }, (_, index) => {
    const times = { 0: '00:10:00', [count - 1]: '23:50:00' }
    const time = count === 1 ? '12:00:00' : (times[index] ?? '12:00:00')
    return visit(domainId, zone, date, time, { duration: count * 30_000 })
  })

const domains = {}

test.before(async (t) => {
  const { user, workspace } = await users.add({
    email: 'period-numbers@example.com',
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: 'Period numbers',
  })
  t.context.token = await Token.create({ userId: user.id })

  const domainOf = async (name, zone) => {
    const domain = await Domain.create({ title: `${name} ${zone}`, workspaceId: workspace.id })
    domains[`${name} ${zone}`] = domain.id
    return domain.id
  }

  for (const zone of zones) {
    for (const [name, window] of Object.entries(windows)) {
      const id = await domainOf(name, zone)
      await Record.insertMany([
        visit(id, zone, shift(window.from, -1), '23:50:00'),
        ...daysOf(window).flatMap((date, index) => dayVisits(id, zone, date, index + 1)),
        visit(id, zone, shift(window.to, 1), '00:10:00'),
      ])
    }

    const months = await domainOf('months', zone)
    await Record.insertMany([
      ...Array.from({ length: 3 }, () => visit(months, zone, '2026-01-05', '12:00:00', { duration: 600_000 })),
      visit(months, zone, '2026-01-20', '12:00:00'),
      visit(months, zone, '2026-03-10', '12:00:00'),
      ...Array.from({ length: 2 }, () => visit(months, zone, '2026-03-20', '12:00:00', { duration: 600_000 })),
    ])

    const edges = await domainOf('edges', zone)
    await Record.insertMany(
      ['2026-01-01', '2026-03-01', '2026-11-03'].map((date) => visit(edges, zone, date, '00:10:00')),
    )

    const firstSeen = await domainOf('firstSeen', zone)
    const seen = (date, browserName, siteLanguage) =>
      visit(firstSeen, zone, date, '12:00:00', {
        browserName,
        browserVersion: '1',
        siteLanguage,
        siteLocation: `https://example.com/${browserName}`,
      })
    await Record.insertMany([
      seen('2025-12-20', 'Firefox', 'en'),
      seen('2025-12-21', 'Opera', 'fr'),
      seen('2026-01-10', 'Firefox', 'en'),
      seen('2026-01-12', 'Chrome', 'uk'),
      seen('2026-02-20', 'Safari', 'de'),
    ])
  }
})

const fetchStatistics = async (t, zone, id, period, fields) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query fetchStatistics($id: ID!, $period: PeriodInput) {
          domain(id: $id) {
            statistics(period: $period) {
              ${fields}
            }
          }
        }
      `,
      variables: { id, period },
    },
    t.context.token.id,
    { 'Time-Zone': zone },
  )

  if (json.errors != null) throw new Error(json.errors[0].message)

  return json.data.domain.statistics
}

const rows = (entries) => entries.map((entry) => [entry.value, entry.count])

// Every check runs on the records and once more with the rollups built
const check = (path) => {
  for (const zone of zones) {
    for (const [name, window] of Object.entries(windows)) {
      test.serial(`${path}: each day of the ${name} window keeps its own numbers in ${zone}`, async (t) => {
        const { total, unique, durations } = await fetchStatistics(
          t,
          zone,
          domains[`${name} ${zone}`],
          window,
          `
            total: views(type: TOTAL, interval: DAILY) { value count }
            unique: views(type: UNIQUE, interval: DAILY) { value count }
            durations(interval: DAILY) { value count }
          `,
        )

        const days = daysOf(window).map((date, index) => [label(date), index + 1])
        t.deepEqual(rows(total), days.toReversed())
        t.deepEqual(rows(unique), days.toReversed())
        t.deepEqual(rows(durations), days.map(([value, count]) => [value, count * 30_000]).toReversed())
      })
    }

    test.serial(`${path}: monthly and yearly charts start with the period in ${zone}`, async (t) => {
      const id = domains[`months ${zone}`]
      const fields = (interval) => `
        views(type: TOTAL, interval: ${interval}) { value count }
        durations(interval: ${interval}) { value count }
        pages(sorting: TOP) { count }
      `

      const months = await fetchStatistics(t, zone, id, { from: '2026-01-15', to: '2026-03-15' }, fields('MONTHLY'))
      t.deepEqual(rows(months.views), [
        ['2026-3', 1],
        ['2026-2', 0],
        ['2026-1', 1],
      ])
      t.deepEqual(rows(months.durations), [
        ['2026-3', 30_000],
        ['2026-2', 0],
        ['2026-1', 30_000],
      ])
      t.is(months.pages[0].count, 2)

      const year = await fetchStatistics(t, zone, id, { from: '2026-03-01', to: '2026-03-15' }, fields('YEARLY'))
      t.deepEqual(rows(year.views), [['2026', 1]])
      t.deepEqual(rows(year.durations), [['2026', 30_000]])
    })

    test.serial(`${path}: a period reaches back to its first minutes in ${zone}`, async (t) => {
      const id = domains[`edges ${zone}`]
      const views = (interval) => `views(type: TOTAL, interval: ${interval}) { value count }`

      const month = await fetchStatistics(t, zone, id, { from: '2026-01-01', to: '2026-01-31' }, views('MONTHLY'))
      t.deepEqual(rows(month.views), [['2026-1', 1]])

      const firstOfMonth = await fetchStatistics(
        t,
        zone,
        id,
        { from: '2026-03-01', to: '2026-03-01' },
        views('MONTHLY'),
      )
      t.deepEqual(rows(firstOfMonth.views), [['2026-3', 1]])

      const lastDay = await fetchStatistics(t, zone, id, { from: '2026-11-03', to: '2026-11-03' }, views('DAILY'))
      t.deepEqual(rows(lastDay.views), [['2026-11-3', 1]])
    })

    test.serial(`${path}: without a period late in the day the rows are the days of ${zone}`, async (t) => {
      const dateDetails = createDate(zone, fromZonedTime('2026-11-03T23:30:00', zone))
      const ids = [domains[`autumn ${zone}`]]
      const days = daysOf(windows.autumn)
        .map((date, index) => [label(date), index + 1])
        .toReversed()

      t.deepEqual(rows(await getViews(ids, 'TOTAL', 'DAILY', 15, dateDetails)), days)
      t.deepEqual(
        rows(await getDurations(ids, 'DAILY', 15, dateDetails)),
        days.map(([value, count]) => [value, count * 30_000]),
      )
    })

    test.serial(`${path}: new entries of a period show when they were first seen in ${zone}`, async (t) => {
      const list = '(sorting: NEW) { value count created }'
      const { browsers, pages, languages } = await fetchStatistics(
        t,
        zone,
        domains[`firstSeen ${zone}`],
        { from: '2026-01-01', to: '2026-01-31' },
        `
          browsers${list.replace('(', '(type: NO_VERSION, ')}
          pages${list}
          languages${list}
        `,
      )

      const entries = (chrome, firefox) => [
        { value: chrome, count: 1, created: fromZonedTime('2026-01-12T12:00:00', zone).toISOString() },
        { value: firefox, count: 1, created: fromZonedTime('2025-12-20T12:00:00', zone).toISOString() },
      ]

      t.deepEqual(browsers, entries('Chrome', 'Firefox'))
      t.deepEqual(pages, entries('https://example.com/Chrome', 'https://example.com/Firefox'))
      t.deepEqual(languages, entries('Ukrainian', 'English'))
    })
  }
}

check('records')

test.serial('the rollups are built', async (t) => {
  t.not(await rollUp(new Date()), undefined)
})

check('rollups')

test.serial('the rows of an export carry the days of the viewer', async (t) => {
  const { from, to } = windows.autumn
  const zone = 'America/New_York'
  const url = new URL(`/export/views.csv?domainId=${domains[`autumn ${zone}`]}&from=${from}&to=${to}`, await base)
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${t.context.token.id}`, 'Time-Zone': zone },
  })

  t.is((await response.text()).split('\r\n')[1], '2026-11-3,15')
})

for (const zone of zones) {
  test.serial(`event charts and GA4 walk the days of ${zone}`, async (t) => {
    const dateDetails = createDate(zone, fromZonedTime('2026-11-03T23:30:00', zone))
    const days = daysOf(windows.autumn)
    const expected = days.map((date, index) => [label(date), index + 1]).toReversed()

    const event = await Event.create({ title: `Period ${zone}`, type: 'TOTAL_CHART', workspaceId: 'unused' })
    for (const [index, date] of days.entries()) {
      const created = fromZonedTime(`${date}T12:00:00`, zone)
      await addAction({ eventId: event.id, key: 'Key', value: index + 1, created, updated: created })
    }
    t.deepEqual(rows(await getChart([event.id], 'TOTAL', 'DAILY', 15, dateDetails)), expected)

    const id = domains[`autumn ${zone}`]
    await Ga4Daily.insertMany(
      days.map((date, index) => ({ domainId: id, dimension: 'total', value: '', date, views: index + 1 })),
    )
    t.deepEqual(rows(await ga4.views([id], 'TOTAL', 'DAILY', 15, dateDetails)), expected)
  })
}
