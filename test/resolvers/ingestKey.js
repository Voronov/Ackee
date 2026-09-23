import test from 'ava'
import listen from 'test-listen'

import Domain from '../../src/models/Domain.js'
import Record from '../../src/models/Record.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

const track = (domainId, headers) =>
  api(
    base,
    {
      query: gql`
        mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
          createRecord(domainId: $domainId, input: $input) {
            success
          }
        }
      `,
      variables: { domainId, input: { siteLocation: 'https://example.com/' } },
    },
    undefined,
    headers,
  )

test.serial('a domain gets an ingest key of its own', async (t) => {
  const first = await Domain.findOne({ id: t.context.domain.id }).lean()

  t.is(typeof first.ingestKey, 'string')
  t.true(first.ingestKey.length >= 20)

  // Two domains must not share a key, or one owner could write into the other's data.
  const second = await Domain.create({ title: 'Other', workspaceId: t.context.workspace.id })
  t.not(second.ingestKey, first.ingestKey)
})

test.serial('with strict mode off an event is accepted without a key', async (t) => {
  const { json } = await track(t.context.domain.id)

  // Existing snippets carry no key, so turning this on by default would break every
  // installation at once.
  t.true(json.data.createRecord.success)
})

test.serial('with strict mode on an event without a key is refused', async (t) => {
  await Domain.updateOne({ id: t.context.domain.id }, { $set: { strictIngest: true, title: 'example.com' } })

  const before = await Record.countDocuments({ domainId: t.context.domain.id })
  const { json } = await track(t.context.domain.id)

  t.regex(json.errors[0].message, /key missing or wrong/i)
  t.is(await Record.countDocuments({ domainId: t.context.domain.id }), before)
})

test.serial('with strict mode on a wrong key is refused', async (t) => {
  await Domain.updateOne({ id: t.context.domain.id }, { $set: { strictIngest: true, title: 'example.com' } })

  const { json } = await track(t.context.domain.id, { 'X-Ackee-Key': 'not-the-key', 'Origin': 'https://example.com' })

  t.regex(json.errors[0].message, /key missing or wrong/i)
})

test.serial('the right key from the right site is accepted', async (t) => {
  await Domain.updateOne({ id: t.context.domain.id }, { $set: { strictIngest: true, title: 'example.com' } })
  const domain = await Domain.findOne({ id: t.context.domain.id }).lean()

  const { json } = await track(t.context.domain.id, {
    'X-Ackee-Key': domain.ingestKey,
    'Origin': 'https://example.com',
  })

  t.true(json.data.createRecord.success)
})

test.serial('the right key from another site is refused', async (t) => {
  await Domain.updateOne({ id: t.context.domain.id }, { $set: { strictIngest: true, title: 'example.com' } })
  const domain = await Domain.findOne({ id: t.context.domain.id }).lean()

  // The key is public, so someone who read it off the page could still try to use it
  // from their own site. The origin check is what stops that particular attempt.
  const { json } = await track(t.context.domain.id, {
    'X-Ackee-Key': domain.ingestKey,
    'Origin': 'https://somewhere-else.example',
  })

  t.regex(json.errors[0].message, /origin does not match/i)
})

test.serial('rotating the key invalidates the old one', async (t) => {
  await Domain.updateOne({ id: t.context.domain.id }, { $set: { strictIngest: true, title: 'example.com' } })
  const before = await Domain.findOne({ id: t.context.domain.id }).lean()

  const { json } = await api(
    base,
    {
      query: gql`
        mutation rotateIngestKey($id: ID!) {
          rotateIngestKey(id: $id) {
            success
            payload {
              ingestKey
            }
          }
        }
      `,
      variables: { id: t.context.domain.id },
    },
    t.context.token.id,
  )

  t.true(json.data.rotateIngestKey.success)
  t.not(json.data.rotateIngestKey.payload.ingestKey, before.ingestKey)

  const refused = await track(t.context.domain.id, {
    'X-Ackee-Key': before.ingestKey,
    'Origin': 'https://example.com',
  })

  t.regex(refused.json.errors[0].message, /key missing or wrong/i)
})

// The bundled tracker sends no headers of its own, so the snippet has to carry the key
// inside the domain id. Without this the strict mode could not be used at all.
test.serial('the key can travel inside the domain id', async (t) => {
  await Domain.updateOne({ id: t.context.domain.id }, { $set: { strictIngest: true, title: 'example.com' } })
  const domain = await Domain.findOne({ id: t.context.domain.id }).lean()

  const accepted = await track(`${domain.id}.${domain.ingestKey}`, { Origin: 'https://example.com' })
  t.true(accepted.json.data.createRecord.success)

  const refused = await track(`${domain.id}.wrong-key`, { Origin: 'https://example.com' })
  t.regex(refused.json.errors[0].message, /key missing or wrong/i)

  // The composed id must not reach storage: records are grouped by the real one.
  const stored = await Record.findOne({ domainId: domain.id }).lean()
  t.not(stored, null)
})
