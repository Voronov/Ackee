import test from 'ava'

import matchesOrigin from '../../src/utils/matchesOrigin.js'

test('the site itself and its subdomains match', (t) => {
  t.true(matchesOrigin('https://example.com', 'example.com'))
  t.true(matchesOrigin('https://www.example.com', 'Example.com'))
})

test('another site does not match, even one that ends the same', (t) => {
  t.false(matchesOrigin('https://somewhere-else.example', 'example.com'))
  t.false(matchesOrigin('https://notexample.com', 'example.com'))
})

test('a missing or broken origin does not match', (t) => {
  t.false(matchesOrigin(undefined, 'example.com'))
  t.false(matchesOrigin('not a url', 'example.com'))
})

test('a title that is not a host name cannot be checked and passes', (t) => {
  t.true(matchesOrigin('https://anywhere.example', 'My blog'))
  t.true(matchesOrigin('https://anywhere.example'))
})
