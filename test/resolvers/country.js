import test from 'ava'
import listen from 'test-listen'
import mockedEnv from 'mocked-env'

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

// A view as the tracker sends it, from the given address behind a proxy. The browser tells
// the visitors apart: the same address and browser is the same person (utils/identifier.js).
const view = async (domainId, ip, browser = 'Mozilla/5.0 (test)') => {
  const { json } = await api(
    base,
    {
      query: gql`
        mutation createRecord($domainId: ID!, $input: CreateRecordInput!) {
          createRecord(domainId: $domainId, input: $input) {
            success
            payload {
              id
            }
          }
        }
      `,
      variables: { domainId, input: { siteLocation: 'https://example.com/' } },
    },
    undefined,
    { 'X-Forwarded-For': ip, 'User-Agent': browser },
  )

  return Record.findOne({ id: json.data.createRecord.payload.id }).lean()
}

const switchOn = (t) => Domain.updateOne({ id: t.context.domain.id }, { collectCountry: true })

const updateDomain = (t, input) =>
  api(
    base,
    {
      query: gql`
        mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
          updateDomain(id: $id, input: $input) {
            payload {
              collectCountry
            }
          }
        }
      `,
      variables: { id: t.context.domain.id, input },
    },
    t.context.token.id,
  )

test.serial('without ACKEE_GEO no view gets a country, whatever the domain asks for', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: undefined })
  await switchOn(t)

  const entry = await view(t.context.domain.id, '8.8.8.8')

  restore()
  t.is(entry.country, undefined)
})

test.serial('with ACKEE_GEO the country is read only for a domain whose owner turned it on', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: 'country' })

  const off = await view(t.context.domain.id, '8.8.8.8', 'Mozilla/5.0 (first)')
  await switchOn(t)
  const on = await view(t.context.domain.id, '8.8.8.8', 'Mozilla/5.0 (second)')

  restore()
  t.is(off.country, undefined)
  t.is(on.country, 'US')
})

test.serial('only the two-letter code is stored: not the address, nothing else', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: 'country' })
  await switchOn(t)

  const entry = await view(t.context.domain.id, '91.198.174.192')

  restore()
  t.is(entry.country, 'NL')
  t.false(JSON.stringify(entry).includes('91.198.174.192'))
  t.deepEqual(
    Object.keys(entry)
      .filter((key) => key !== '_id' && key !== '__v')
      .toSorted(),
    ['clientId', 'country', 'created', 'domainId', 'id', 'siteLocation', 'updated'],
  )
})

test.serial('a private address gives no country, and the view is stored all the same', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: 'country' })
  await switchOn(t)

  const entry = await view(t.context.domain.id, '10.0.0.1')

  restore()
  t.is(entry.country, undefined)
  // Stored as normalizeUrl leaves it, without the trailing slash
  t.is(entry.siteLocation, 'https://example.com')
})

test.serial('the next visit of the same person removes the country like the other personal data', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: 'country' })
  await switchOn(t)

  const first = await view(t.context.domain.id, '8.8.8.8')
  const second = await view(t.context.domain.id, '8.8.8.8')

  restore()
  t.is(second.country, 'US')
  t.is((await Record.findOne({ id: first.id }).lean()).country, null)
})

test.serial('the owner turns it on and off through updateDomain, and a rename leaves it alone', async (t) => {
  const on = await updateDomain(t, { title: 'Example', collectCountry: true })
  t.true(on.json.data.updateDomain.payload.collectCountry)
  t.true((await Domain.findOne({ id: t.context.domain.id }).lean()).collectCountry)

  const renamed = await updateDomain(t, { title: 'Renamed' })
  t.true(renamed.json.data.updateDomain.payload.collectCountry)

  const off = await updateDomain(t, { title: 'Renamed', collectCountry: false })
  t.false(off.json.data.updateDomain.payload.collectCountry)
  t.false((await Domain.findOne({ id: t.context.domain.id }).lean()).collectCountry)
})

test.serial('countryAvailable tells whether the instance can do it, before anyone signs in', async (t) => {
  const ask = () => api(base, { query: '{ countryAvailable }' })

  const restoreOff = mockedEnv({ ACKEE_GEO: undefined })
  t.false((await ask()).json.data.countryAvailable)
  restoreOff()

  const restoreOn = mockedEnv({ ACKEE_GEO: 'country' })
  t.true((await ask()).json.data.countryAvailable)
  restoreOn()
})
