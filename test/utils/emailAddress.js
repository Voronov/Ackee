import test from 'ava'

import { looksLikeEmail } from '../../src/utils/emailAddress.js'

test('an ordinary address passes', (t) => {
  t.true(looksLikeEmail('someone@example.com'))
  t.true(looksLikeEmail(`${'a'.repeat(64)}@example.com`))
})

test('something that is not an address fails', (t) => {
  t.false(looksLikeEmail('not-an-address'))
  t.false(looksLikeEmail('two@at@example.com'))
  t.false(looksLikeEmail('spaced out@example.com'))
  t.false(looksLikeEmail('nobody@localhost'))
  t.false(looksLikeEmail(null))
})

test('an address longer than mail servers accept fails', (t) => {
  // RFC 5321: 64 characters before the @, 254 in all
  t.false(looksLikeEmail(`${'a'.repeat(65)}@example.com`))
  t.false(looksLikeEmail(`${'a'.repeat(300)}@example.com`))
  t.false(looksLikeEmail(`someone@${'sub.'.repeat(62)}example.com`))
})
