import test from 'ava'
import { format, subDays } from 'date-fns'
import listen from 'test-listen'

import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { DEFAULT_WORKSPACE_ID } from '../../src/constants/workspaces.js'
import { isPeriod } from '../../src/ui/scripts/hooks/useScope.js'
import { day, hour } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.afterEach.always(cleanupDatabase)

// The zone of this process, so the days of the test and of the server are the same
const UTC = { 'Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone }
const dayOf = (date) => format(date, 'yyyy-MM-dd')

// Three kinds of visits: to the cart from Google in Chrome, to the start page from Hacker News in
// Firefox, and to the cart without a referrer in Safari, ten days ago
test.beforeEach(async (t) => {
  await fillDatabase(t)
  t.context.domain = await Domain.create({ title: 'Filters', workspaceId: DEFAULT_WORKSPACE_ID })

  const now = Date.now()
  const visit = (fields, created, count) =>
    Array.from({ length: count }, () => ({
      domainId: t.context.domain.id,
      siteLocation: 'https://example.com/',
      created: new Date(created),
      updated: new Date(created + 20_000),
      ...fields,
    }))

  await Record.insertMany([
    ...visit(
      {
        siteLocation: 'https://example.com/cart',
        siteReferrer: 'https://google.com/',
        browserName: 'Chrome',
        browserVersion: '120',
        osName: 'macOS',
        country: 'UA',
        clientId: 'a-visitor-in-chrome',
      },
      now - hour,
      3,
    ),
    ...visit(
      {
        siteReferrer: 'https://news.ycombinator.com/',
        browserName: 'Firefox',
        browserVersion: '119',
        osName: 'Windows',
        clientId: 'a-visitor-in-firefox',
        country: 'US',
      },
      now - 2 * day,
      2,
    ),
    ...visit(
      {
        siteLocation: 'https://example.com/cart',
        browserName: 'Safari',
        browserVersion: '17',
        osName: 'iOS',
        source: 'Newsletter',
      },
      now - 10 * day,
      4,
    ),
  ])
})

const statistics = async (t, fields, { filters, period, source } = {}) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query fetchStatistics($id: ID!, $filters: [FilterInput!], $period: PeriodInput, $source: StatisticsSource) {
          domain(id: $id) {
            statistics(filters: $filters, period: $period, source: $source) {
              id
              ${fields}
            }
          }
        }
      `,
      variables: { id: t.context.domain.id, filters, period, source },
    },
    t.context.token.id,
    UTC,
  )

  return json
}

const data = async (t, fields, scope) => {
  const json = await statistics(t, fields, scope)
  if (json.errors != null) throw new Error(json.errors[0].message)
  return json.data.domain.statistics
}

const sum = (entries) => entries.reduce((total, entry) => total + entry.count, 0)

const CART = { field: 'SITE_LOCATION', value: 'https://example.com/cart' }

test.serial('a filter narrows the charts and the lists to its views', async (t) => {
  const report = await data(
    t,
    `
      views(type: TOTAL, interval: DAILY, limit: 14) { count }
      pages(sorting: TOP, range: LAST_6_MONTHS) { value count }
      referrers(sorting: TOP, type: NO_SOURCE, range: LAST_6_MONTHS) { value count }
      browsers(sorting: TOP, type: NO_VERSION, range: LAST_6_MONTHS) { value count }
      durations(interval: DAILY, limit: 14) { count }
    `,
    { filters: [CART] },
  )

  t.is(sum(report.views), 7)
  t.deepEqual(report.pages, [{ value: 'https://example.com/cart', count: 7 }])
  // Where the visitors of the cart came from: Google, the others came without a referrer
  t.deepEqual(report.referrers, [{ value: 'https://google.com/', count: 3 }])
  t.deepEqual(
    report.browsers.map((entry) => entry.value),
    ['Safari', 'Chrome'],
  )
})

test.serial('filters add up: every one of them must match', async (t) => {
  const report = await data(t, 'pages(sorting: TOP, range: LAST_6_MONTHS) { value count }', {
    filters: [CART, { field: 'BROWSER_NAME', value: 'Safari' }],
  })

  t.deepEqual(report.pages, [{ value: 'https://example.com/cart', count: 4 }])
})

test.serial('an entry hands back the filter of its group, and that filter narrows the reports to it', async (t) => {
  const { browsers } = await data(
    t,
    'browsers(sorting: TOP, type: WITH_VERSION, range: LAST_6_MONTHS) { value count filter { field value } }',
  )
  const chrome = browsers.find((entry) => entry.value === 'Chrome 120')
  t.deepEqual(chrome.filter, [
    { field: 'BROWSER_NAME', value: 'Chrome' },
    { field: 'BROWSER_VERSION', value: '120' },
  ])

  const report = await data(t, 'countries(sorting: TOP, range: LAST_6_MONTHS) { value count filter { field value } }', {
    filters: chrome.filter,
  })
  t.deepEqual(report.countries, [{ value: 'Ukraine', count: 3, filter: [{ field: 'COUNTRY', value: 'UA' }] }])
})

test.serial('a referrer with its source hands back the field it shows', async (t) => {
  const { referrers } = await data(
    t,
    'referrers(sorting: TOP, type: WITH_SOURCE, range: LAST_6_MONTHS) { value filter { field value } }',
  )

  t.deepEqual(referrers.find((entry) => entry.value === 'Newsletter').filter, [
    { field: 'SOURCE', value: 'Newsletter' },
  ])
  t.deepEqual(referrers.find((entry) => entry.value === 'https://google.com/').filter, [
    { field: 'SITE_REFERRER', value: 'https://google.com/' },
  ])
})

test.serial('a filter without a value means the views without the field', async (t) => {
  const report = await data(t, 'browsers(sorting: TOP, type: NO_VERSION, range: LAST_6_MONTHS) { value count }', {
    filters: [{ field: 'SITE_REFERRER', value: null }],
  })

  t.deepEqual(report.browsers, [{ value: 'Safari', count: 4 }])
})

test.serial('the facts take the filters too', async (t) => {
  const facts = async (filters) => {
    const { json } = await api(
      base,
      {
        query: gql`
          query fetchFacts($id: ID!, $filters: [FilterInput!]) {
            domain(id: $id) {
              facts(filters: $filters) {
                id
                viewsYear
              }
            }
          }
        `,
        variables: { id: t.context.domain.id, filters },
      },
      t.context.token.id,
      UTC,
    )
    if (json.errors != null) throw new Error(json.errors[0].message)
    return json.data.domain.facts
  }

  // Unique views are the records with a clientId: three in Chrome, two in Firefox
  t.is((await facts()).viewsYear, 5)
  t.is((await facts([{ field: 'COUNTRY', value: 'US' }])).viewsYear, 2)
})

test.serial('a period replaces the range of the lists and the charts show its days', async (t) => {
  const from = subDays(new Date(), 11)
  const to = subDays(new Date(), 9)
  const period = { from: dayOf(from), to: dayOf(to) }

  const report = await data(
    t,
    `
      views(type: TOTAL, interval: DAILY) { value count }
      pages(sorting: TOP, range: LAST_24_HOURS) { value count }
    `,
    { period },
  )

  // Three days, the last one first, as without a period
  t.deepEqual(
    report.views.map((entry) => entry.value),
    [to, subDays(new Date(), 10), from].map((date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`),
  )
  t.is(sum(report.views), 4)
  // Nothing of the last 24 hours: the range of the list is the period now
  t.deepEqual(report.pages, [{ value: 'https://example.com/cart', count: 4 }])
})

test.serial('a period ends with its last day', async (t) => {
  const report = await data(t, 'pages(sorting: TOP, range: LAST_24_HOURS) { value count }', {
    period: { from: dayOf(subDays(new Date(), 30)), to: dayOf(subDays(new Date(), 3)) },
  })

  // Ten days ago is in it; two days ago and the last hour are after it
  t.deepEqual(report.pages, [{ value: 'https://example.com/cart', count: 4 }])
})

test.serial('filtered numbers get ids of their own, so the cache of the interface keeps them apart', async (t) => {
  const fields = 'pages(sorting: TOP, range: LAST_6_MONTHS) { id value count }'
  const all = await data(t, fields)
  const cart = await data(t, fields, { filters: [CART] })

  t.not(all.id, cart.id)
  const ids = new Set(all.pages.map((entry) => entry.id))
  t.false(cart.pages.some((entry) => ids.has(entry.id)))
})

test.serial('a wrong period or too many filters are refused', async (t) => {
  const fields = 'pages(sorting: TOP) { value }'
  const message = async (scope) => (await statistics(t, fields, scope)).errors?.[0].message

  t.regex(await message({ period: { from: '2026-13-01', to: '2026-12-01' } }), /Invalid day/)
  t.regex(await message({ period: { from: '2026-02-30', to: '2026-03-01' } }), /Invalid day/)
  t.regex(await message({ period: { from: '2026-03-02', to: '2026-03-01' } }), /ends before it starts/)
  t.regex(await message({ filters: Array.from({ length: 11 }, () => CART) }), /At most 10 filters/)
})

test.serial('the interface and the server agree on which periods exist', async (t) => {
  const fields =
    'pages(sorting: TOP) { value } views(interval: DAILY, type: UNIQUE) { count } monthly: views(interval: MONTHLY, type: TOTAL) { count } durations(interval: DAILY) { count } referrers(sorting: TOP, type: WITH_SOURCE) { value } systems(sorting: TOP, type: WITH_VERSION) { value }'

  for (const period of [
    { from: '2026-02-01', to: '2026-02-28' },
    { from: '2026-02-01', to: '2026-02-31' },
    { from: '2024-02-29', to: '2024-02-29' },
    { from: '1900-02-29', to: '1900-03-01' },
    { from: '2026-04-01', to: '2026-04-31' },
    { from: '0000-01-01', to: '0000-01-31' },
    { from: '0001-01-01', to: '0001-01-31' },
    { from: '9999-12-01', to: '9999-12-30' },
    { from: '9999-12-01', to: '9999-12-31' },
    { from: '2016-10-30', to: '2026-11-06' },
    { from: '2016-10-29', to: '2026-11-06' },
  ]) {
    const { errors } = await statistics(t, fields, { period })
    t.is(isPeriod(period), errors == null, `${period.from} ${period.to}: ${errors?.[0].message}`)
  }
})

test.serial('Google Analytics 4 has nothing to filter', async (t) => {
  const json = await statistics(t, 'pages(sorting: TOP) { value }', { filters: [CART], source: 'GA4' })

  t.regex(json.errors[0].message, /only available for the views collected by Ackee/)
})
