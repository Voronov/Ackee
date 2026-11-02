import test from 'ava'
import listen from 'test-listen'

import Record from '../../../src/models/Record.js'
import server from '../../../src/server.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from '../_utils.js'
import { getStats } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
// The fixture has no countries: three views from the US, the rest from Ukraine. One hook, as
// AVA runs several beforeEach hooks at the same time.
test.beforeEach(async (t) => {
  await fillDatabase(t)
  await Record.updateMany({ domainId: t.context.domain.id }, { country: 'UA' })
  await Record.updateMany(
    { domainId: t.context.domain.id, clientId: { $in: ['client-0', 'client-1', 'client-2'] } },
    { country: 'US' },
  )
})
test.afterEach.always(cleanupDatabase)

const macro = async (t, variables, assertions) => {
  const limit = variables.limit == null ? '' : `, limit: ${variables.limit}`

  const statistics = await getStats({
    base,
    token: t.context.token.id,
    domainId: t.context.domain.id,
    fragment: `
			countries(sorting: ${variables.sorting}, range: ${variables.range}${limit}) {
				value
				count
				created
			}
		`,
  })

  assertions(t, statistics.countries)
}

macro.title = (providedTitle, options) => `fetch ${Object.values(options).join(' and ')} countries`

test(
  macro,
  {
    sorting: 'TOP',
    range: 'LAST_6_MONTHS',
  },
  (t, countries) => {
    t.deepEqual(
      countries.map((country) => [country.value, country.count]),
      [
        ['Ukraine', 11],
        ['United States', 3],
      ],
    )
  },
)

test(
  macro,
  {
    sorting: 'RECENT',
    range: 'LAST_6_MONTHS',
  },
  (t, countries) => {
    t.is(countries.length, 14)
    t.is(countries[0].value, 'United States')
  },
)

test(
  macro,
  {
    sorting: 'RECENT',
    range: 'LAST_6_MONTHS',
    limit: 1,
  },
  (t, countries) => {
    t.is(countries.length, 1)
  },
)

test(
  macro,
  {
    sorting: 'NEW',
    range: 'LAST_6_MONTHS',
  },
  (t, countries) => {
    t.deepEqual(countries.map((country) => country.value).toSorted(), ['Ukraine', 'United States'])
  },
)

test('a view without a country is left out, like for the other reports', async (t) => {
  await Record.updateMany({ domainId: t.context.domain.id, clientId: 'client-3' }, { $unset: { country: 1 } })

  const statistics = await getStats({
    base,
    token: t.context.token.id,
    domainId: t.context.domain.id,
    fragment: 'countries(sorting: TOP, range: LAST_6_MONTHS) { value count }',
  })

  t.deepEqual(
    statistics.countries.map((country) => [country.value, country.count]),
    [
      ['Ukraine', 10],
      ['United States', 3],
    ],
  )
})
