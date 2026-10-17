import test from 'ava'

import salt, { job, rule } from '../../src/utils/salt.js'

test.after.always(() => {
  job.cancel()
})

test('return same result as long as it is the same day', (t) => {
  const a = salt()
  const b = salt()

  t.is(a, b)
})

test('generates a new salt once a day', (t) => {
  const afterMidnight = new Date(2026, 9, 18, 0, 0, 30)

  t.is(rule.nextInvocationDate(afterMidnight).getTime(), new Date(2026, 9, 19).getTime())
})
