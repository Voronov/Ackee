import { fileURLToPath } from 'node:url'

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

// Review of #71: docs/Options.md names GeoLite2 and DB-IP Lite, which keep the code elsewhere.
// The file is the GeoLite2 test database of maxmind/MaxMind-DB (Apache-2.0), 13 KB.
test.serial('a database in the GeoIP2 layout, such as GeoLite2, gives the country too', async (t) => {
  reset()
  const database = fileURLToPath(new URL('../fixtures/GeoLite2-Country-Test.mmdb', import.meta.url))
  const restore = mockedEnv({ ACKEE_GEO: 'country', ACKEE_GEO_DATABASE: database })

  t.is(await countryOf('81.2.69.142'), 'GB')
  t.is(await countryOf('89.160.20.112'), 'SE')
  t.is(await countryOf('10.0.0.1'), null)

  restore()
  reset()
})
