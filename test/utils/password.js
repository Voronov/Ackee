import test from 'ava'

import { hash, verify } from '../../src/utils/password.js'

test('a password matches its own hash', async (t) => {
  t.true(await verify('correct horse battery', await hash('correct horse battery')))
})

test('a wrong password does not match', async (t) => {
  t.false(await verify('wrong password', await hash('correct horse battery')))
})

// The same password must not give the same hash, or equal passwords would be visible in the database.
test('every hash has its own salt', async (t) => {
  t.not(await hash('same password'), await hash('same password'))
})

test('a stored value that is not a scrypt hash never matches', async (t) => {
  t.false(await verify('anything', 'plain text'))
  t.false(await verify('anything', null))
})
