import test from 'ava'

import touchLimit from '../../src/utils/touchLimit.js'
import { minute } from '../../src/utils/times.js'

test('refuses an address once it used its limit in a minute', (t) => {
  const within = touchLimit(() => 0)

  t.true(within('1.1.1.1', 2))
  t.true(within('1.1.1.1', 2))
  t.false(within('1.1.1.1', 2))
  t.false(within('1.1.1.1', 2))
})

test('counts every address on its own', (t) => {
  const within = touchLimit(() => 0)

  t.true(within('1.1.1.1', 1))
  t.false(within('1.1.1.1', 1))
  t.true(within('2.2.2.2', 1))
})

test('lets an address in again when the minute is over', (t) => {
  let time = 0
  const within = touchLimit(() => time)

  t.true(within('1.1.1.1', 1))
  t.false(within('1.1.1.1', 1))

  time = minute - 1
  t.false(within('1.1.1.1', 1))

  time = minute
  t.true(within('1.1.1.1', 1))
})

test('a limit of 0 is off', (t) => {
  const within = touchLimit(() => 0)

  for (let index = 0; index < 100; index++) t.true(within('1.1.1.1', 0))
})
