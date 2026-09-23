import test from 'ava'
import listen from 'test-listen'

import Domain from '../src/models/Domain.js'
import Record from '../src/models/Record.js'
import server from '../src/server.js'
import { api } from './_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './resolvers/_utils.js'

const base = listen(server)

// The role is read when the server module is imported, and ESM evaluates imports before
// any statement in this file. So it has to come from outside: `npm run test:roles`.
// Without it these tests would silently run against the single-process setup and pass
// for the wrong reason.
const isIngest = process.env.ACKEE_ROLE === 'INGEST'

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('the ingest service accepts events', async (t) => {
  if (isIngest === false) return t.pass('not running as ingest, skipped')

  const before = await Record.countDocuments({ domainId: t.context.domain.id })

  const { json } = await api(base, {
    query: gql`
      mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
        createRecord(domainId: $domainId, input: $input) {
          success
        }
      }
    `,
    variables: { domainId: t.context.domain.id, input: { siteLocation: 'https://example.com/' } },
  })

  t.true(json.data.createRecord.success)

  // The fixture already puts records in, so the delta is what matters.
  t.is(await Record.countDocuments({ domainId: t.context.domain.id }), before + 1)
})

// This is the point of the split. A process that takes anonymous traffic cannot read
// reports, because those operations are not in its schema at all — not forbidden, absent.
test.serial('the ingest service has no reports', async (t) => {
  if (isIngest === false) return t.pass('not running as ingest, skipped')

  const { json } = await api(
    base,
    {
      query: gql`
        query {
          domains {
            id
          }
        }
      `,
    },
    t.context.token.id,
  )

  t.truthy(json.errors)
  t.regex(json.errors[0].message, /cannot query field "domains"/i)
})

test.serial('the ingest service cannot issue tokens', async (t) => {
  if (isIngest === false) return t.pass('not running as ingest, skipped')

  const { json } = await api(base, {
    query: gql`
      mutation createToken($input: CreateTokenInput!) {
        createToken(input: $input) {
          success
        }
      }
    `,
    variables: { input: { username: t.context.email, password: t.context.password } },
  })

  t.truthy(json.errors)

  // Refused at the input type, before the field is even considered: neither exists here.
  t.regex(json.errors[0].message, /unknown type "CreateTokenInput"/i)
})

test.serial('the ingest service cannot create domains', async (t) => {
  if (isIngest === false) return t.pass('not running as ingest, skipped')

  const before = await Domain.countDocuments()

  const { json } = await api(
    base,
    {
      query: gql`
        mutation createDomain($input: CreateDomainInput!) {
          createDomain(input: $input) {
            success
          }
        }
      `,
      variables: { input: { title: 'sneaky.example.com' } },
    },
    t.context.token.id,
  )

  t.truthy(json.errors)
  t.is(await Domain.countDocuments(), before)
})

test.serial('the ingest service serves no interface', async (t) => {
  if (isIngest === false) return t.pass('not running as ingest, skipped')

  const response = await fetch(new URL('/', await base).href)

  // The interface belongs to the API service. Serving it from here would mean shipping
  // the whole administration surface on the host that takes anonymous traffic.
  t.is(response.status, 404)
})
