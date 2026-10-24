import test from 'ava'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

const record = (domainId, count) =>
  // With a clientId, so the unique counts of the facts see them too
  Array.from({ length: count }, (_, index) => ({
    domainId,
    clientId: `${domainId}-${index}`,
    siteLocation: 'https://example.com/',
    created: new Date(),
  }))

test.before(async (t) => {
  const own = await users.add({ email: 'picker@example.com', password: 'sufficiently-long' })
  const other = await users.add({ email: 'other-picker@example.com', password: 'sufficiently-long' })

  const shop = await Domain.create({ title: 'shop.example.com', workspaceId: own.workspace.id })
  const journal = await Domain.create({ title: 'journal.example.com', workspaceId: own.workspace.id })
  const foreign = await Domain.create({ title: 'foreign.example.com', workspaceId: other.workspace.id })

  await Record.insertMany([...record(shop.id, 3), ...record(journal.id, 2), ...record(foreign.id, 7)])

  const token = await Token.create({ userId: own.user.id })
  Object.assign(t.context, { shop, foreign, call: (query, variables) => api(base, { query, variables }, token.id) })
})

const totals = async (t, domainId) => {
  const { json } = await t.context.call(
    gql`
      query totals($domainId: ID) {
        statistics(domainId: $domainId) {
          views(interval: YEARLY, type: TOTAL, limit: 1) {
            count
          }
        }
        facts(domainId: $domainId) {
          viewsToday
        }
      }
    `,
    { domainId },
  )

  return json
}

test('without a domain the dashboard sums all domains of the viewer', async (t) => {
  const { data } = await totals(t)

  t.is(data.statistics.views[0].count, 5)
  t.is(data.facts.viewsToday, 5)
})

test('a picked domain narrows statistics and facts to it', async (t) => {
  const { data } = await totals(t, t.context.shop.id)

  t.is(data.statistics.views[0].count, 3)
  t.is(data.facts.viewsToday, 3)
})

test('a domain of someone else is unknown, not empty', async (t) => {
  const { errors, data } = await totals(t, t.context.foreign.id)

  t.regex(errors[0].message, /unknown domain/i)
  t.is(data, null)
})

test('picking a domain needs a token', async (t) => {
  const { json } = await api(base, {
    query: gql`
      query totals($domainId: ID) {
        statistics(domainId: $domainId) {
          id
        }
      }
    `,
    variables: { domainId: t.context.shop.id },
  })

  t.regex(json.errors[0].message, /token missing/i)
})
