import test from 'ava'

import createDate from '../../src/utils/createDate.js'
import serverTimeZone from '../../src/utils/timeZone.js'

test('uses a valid user timezone', (t) => {
  t.is(createDate('UTC').userTimeZone, 'UTC')
})

test('falls back to the server timezone for an invalid user timezone', (t) => {
  t.is(createDate('not/a-timezone').userTimeZone, serverTimeZone)
})

test('measures from the given date instead of now', (t) => {
  const now = new Date('2026-09-21T12:00:00.000Z')
  const dateDetails = createDate('UTC', now)

  t.is(dateDetails.lastHours(24).getTime(), Date.parse('2026-09-20T12:00:00.000Z'))
  t.is(dateDetails.lastMilliseconds(1).getTime(), now.getTime() - 1)
})
