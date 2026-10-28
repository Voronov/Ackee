import test from 'ava'

import findMatchingOrigin, { matchesAutoOrigin } from '../../src/utils/findMatchingOrigin.js'

// The domains of the instance, as fullyQualifiedDomainNames would list them
const names = ['shop.example.com', 'Blog.Example.com']

test('auto origin matches the site by host, with or without a port', (t) => {
  t.true(matchesAutoOrigin('https://shop.example.com', names))
  t.true(matchesAutoOrigin('http://shop.example.com:8080', names))
  t.true(matchesAutoOrigin('http://blog.example.com', names))
})

test('auto origin refuses other sites, other schemes and broken origins', (t) => {
  t.false(matchesAutoOrigin('https://other.example.com', names))
  t.false(matchesAutoOrigin('https://shop.example.com.evil.test', names))
  t.false(matchesAutoOrigin('ftp://shop.example.com', names))
  t.false(matchesAutoOrigin('shop.example.com', names))
  t.false(matchesAutoOrigin(null, names))
  t.false(matchesAutoOrigin('https://shop.example.com', []))
})

test('a configured list is matched exactly, so a port has to be listed', async (t) => {
  const allowed = 'https://shop.example.com,http://localhost:8080'

  t.is(await findMatchingOrigin('https://shop.example.com', allowed, false), 'https://shop.example.com')
  t.is(await findMatchingOrigin('http://localhost:8080', allowed, false), 'http://localhost:8080')
  // Nothing rather than null: "null" is an origin of its own and must never be reflected
  t.is(await findMatchingOrigin('http://shop.example.com:8080', allowed, false), undefined)
  t.is(await findMatchingOrigin('https://shop.example.com', '*', false), '*')
  t.is(await findMatchingOrigin('https://shop.example.com', null, false), undefined)
})
