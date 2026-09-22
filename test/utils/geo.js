import test from 'ava'

import countryOf, { ready } from '../../src/utils/geo.js'

// The flag is read from the environment on every call, so test order does not matter.
const enable = () => {
  process.env.ACKEE_GEO = 'true'
}

const disable = () => {
  delete process.env.ACKEE_GEO
}

test.serial('geolocation resolves nothing while it is off', (t) => {
  disable()

  t.is(countryOf('8.8.8.8'), null)
})

test.serial('resolves a country for IPv4 and IPv6', async (t) => {
  enable()
  await ready()

  t.is(countryOf('8.8.8.8'), 'US')
  t.is(countryOf('1.1.1.1'), 'AU')
  t.is(countryOf('2a00:1450:4001:80f::200e'), 'IE')
})

test.serial('addresses with no country do not break an event', async (t) => {
  enable()
  await ready()

  // Local and private addresses are not in the database, and neither is junk. None of
  // these may throw or return anything but null: a missing country is no reason to reject
  // an event.
  t.is(countryOf('127.0.0.1'), null)
  t.is(countryOf('10.0.0.1'), null)
  t.is(countryOf('not-an-address'), null)
  t.is(countryOf(null), null)
  // Separately: when there was no address header at all.
  t.is(countryOf(), null)

  disable()
})
