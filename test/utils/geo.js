import test from 'ava'
import mockedEnv from 'mocked-env'

import { countryOf, isEnabled, reset } from '../../src/utils/geo.js'

test.serial('off unless ACKEE_GEO is country', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: undefined })

  t.false(isEnabled())
  t.is(await countryOf('8.8.8.8'), null)

  restore()
})

test.serial('a public address gives its country, also in the form a proxy hands it over', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: 'country' })

  t.true(isEnabled())
  t.is(await countryOf('8.8.8.8'), 'US')
  t.is(await countryOf('::ffff:8.8.8.8'), 'US')
  t.is(await countryOf('2a00:1450:4001:80e::200e'), 'IE')

  restore()
})

test.serial('a private, malformed or missing address gives no country', async (t) => {
  const restore = mockedEnv({ ACKEE_GEO: 'country' })

  for (const ip of ['10.0.0.1', '127.0.0.1', '::1', 'not an address', '', null, undefined]) {
    t.is(await countryOf(ip), null, String(ip))
  }

  restore()
})

test.serial('a database that cannot be read gives no country rather than an error', async (t) => {
  reset()
  const restore = mockedEnv({ ACKEE_GEO: 'country', ACKEE_GEO_DATABASE: '/nowhere/country.mmdb' })

  t.is(await countryOf('8.8.8.8'), null)

  restore()
  reset()
})
