import test from 'ava'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Event from '../../src/models/Event.js'
import PermanentToken from '../../src/models/PermanentToken.js'
import Record from '../../src/models/Record.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { day } from '../../src/utils/times.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// Two unrelated accounts, each with a workspace, a domain and its own records.
// Everything below asks the same question: can one of them reach the other's data?
const tenant = async (name, views) => {
  const { user, workspace } = await users.add({
    email: `${name}@example.com`,
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: name,
  })

  const domain = await Domain.create({ title: `${name}.example.com`, workspaceId: workspace.id })
  const event = await Event.create({ title: `${name} signups`, type: 'TOTAL_CHART', workspaceId: workspace.id })
  const token = await Token.create({ userId: user.id })

  await Record.insertMany(
    Array.from({ length: views }, (_, index) => ({
      clientId: `${name}-client-${index}`,
      domainId: domain.id,
      siteLocation: `https://${name}.example.com/`,
      created: Date.now() - index * day,
      updated: Date.now() - index * day,
    })),
  )

  return { user, workspace, domain, event, token }
}

let alice
let mallory

test.before(async () => {
  alice = await tenant('alice', 3)
  mallory = await tenant('mallory', 7)
})

test('only your own domains are listed', async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query {
          domains {
            id
            title
          }
        }
      `,
    },
    alice.token.id,
  )

  t.is(json.data.domains.length, 1)
  t.is(json.data.domains[0].id, alice.domain.id)
})

test("another workspace's domain does not exist", async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query fetchDomain($id: ID!) {
          domain(id: $id) {
            id
          }
        }
      `,
      variables: { id: mallory.domain.id },
    },
    alice.token.id,
  )

  // Not "forbidden" but empty: the domain's existence is never confirmed.
  t.is(json.data.domain, null)
})

test("another workspace's domain cannot be changed or deleted", async (t) => {
  const update = await api(
    base,
    {
      query: gql`
        mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
          updateDomain(id: $id, input: $input) {
            success
          }
        }
      `,
      variables: { id: mallory.domain.id, input: { title: 'taken-over.example.com' } },
    },
    alice.token.id,
  )

  t.truthy(update.json.errors)

  const remove = await api(
    base,
    {
      query: gql`
        mutation deleteDomain($id: ID!) {
          deleteDomain(id: $id) {
            success
          }
        }
      `,
      variables: { id: mallory.domain.id },
    },
    alice.token.id,
  )

  t.truthy(remove.json.errors)

  // The important part: the other account's records are intact. Deleting a domain wipes
  // its records, so a successful call would destroy data knowing only an id.
  t.is(await Record.countDocuments({ domainId: mallory.domain.id }), 7)
})

test('combined statistics count only your own domains', async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query {
          statistics {
            views(interval: DAILY, type: TOTAL, limit: 30) {
              count
            }
          }
        }
      `,
    },
    alice.token.id,
  )

  const total = json.data.statistics.views.reduce((sum, entry) => sum + entry.count, 0)

  // Three records of her own and none of the seven in the other workspace.
  t.is(total, 3)
})

test("another workspace's statistics are out of reach", async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query fetchDomain($id: ID!) {
          domain(id: $id) {
            statistics {
              views(interval: DAILY, type: TOTAL, limit: 30) {
                count
              }
            }
          }
        }
      `,
      variables: { id: mallory.domain.id },
    },
    alice.token.id,
  )

  t.is(json.data.domain, null)
})

// Events had the same hole as domains: the model carried no owner at all, so every account
// on the instance could read and delete every other account's events.
test('only your own events are listed', async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        query {
          events {
            id
            title
          }
        }
      `,
    },
    alice.token.id,
  )

  t.is(json.data.events.length, 1)
  t.is(json.data.events[0].id, alice.event.id)
})

test("another workspace's event cannot be deleted", async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        mutation deleteEvent($id: ID!) {
          deleteEvent(id: $id) {
            success
          }
        }
      `,
      variables: { id: mallory.event.id },
    },
    alice.token.id,
  )

  t.truthy(json.errors)
  t.not(await Event.findOne({ id: mallory.event.id }), null)
})

// An API token acts as its owner, and its id is the secret itself. Seeing another
// account's token would mean acting as that account.
test("another account's API tokens are neither listed nor reachable", async (t) => {
  const malloryToken = await PermanentToken.create({ title: 'Mallory CI', userId: mallory.user.id })
  const aliceToken = await PermanentToken.create({ title: 'Alice CI', userId: alice.user.id })

  const call = (query, variables) => api(base, { query, variables }, alice.token.id)

  const listed = await call(gql`
    query {
      permanentTokens {
        id
      }
    }
  `)
  t.deepEqual(
    listed.json.data.permanentTokens.map((token) => token.id),
    [aliceToken.id],
  )

  const fetched = await call(
    gql`
      query fetchToken($id: ID!) {
        permanentToken(id: $id) {
          id
        }
      }
    `,
    { id: malloryToken.id },
  )
  t.is(fetched.json.data.permanentToken, null)

  const deleted = await call(
    gql`
      mutation deleteToken($id: ID!) {
        deletePermanentToken(id: $id) {
          success
        }
      }
    `,
    { id: malloryToken.id },
  )
  t.regex(deleted.json.errors[0].message, /unknown token/i)
  t.not(await PermanentToken.findOne({ id: malloryToken.id }), null)
})

test("another workspace's event cannot be changed", async (t) => {
  const { json } = await api(
    base,
    {
      query: gql`
        mutation updateEvent($id: ID!, $input: UpdateEventInput!) {
          updateEvent(id: $id, input: $input) {
            success
          }
        }
      `,
      variables: { id: mallory.event.id, input: { title: 'Taken over', type: 'TOTAL_CHART' } },
    },
    alice.token.id,
  )

  t.regex(json.errors[0].message, /unknown event/i)
  t.is((await Event.findOne({ id: mallory.event.id })).title, 'mallory signups')
})
