import test from 'ava'
import listen from 'test-listen'

import server from '../../../src/server.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from '../_utils.js'
import { getStats } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
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
				code
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
    // The fixture holds 10 records from UA and 4 from DE.
    t.is(countries.length, 2)
    t.is(countries[0].value, 'Ukraine')
    t.is(countries[0].code, 'UA')
    t.is(countries[0].count, 10)
    t.is(countries[1].value, 'Germany')
    t.is(countries[1].count, 4)
  },
)

test(
  macro,
  {
    sorting: 'TOP',
    range: 'LAST_6_MONTHS',
    limit: 1,
  },
  (t, countries) => {
    t.is(countries.length, 1)
    t.is(countries[0].code, 'UA')
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
    // The code sits next to the name: the interface needs it for maps and flags.
    t.true(countries.every((entry) => entry.code.length === 2))
  },
)
