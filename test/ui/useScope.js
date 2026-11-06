import test from 'ava'

import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../../src/constants/intervals.js'
import { isPeriod, parse, periodLabel, periodUnits } from '../../src/ui/scripts/hooks/useScope.js'

const LONGEST = { from: '2016-10-30', to: '2026-11-06' }
const TOO_LONG = { from: '2016-10-29', to: '2026-11-06' }

test('a period has at most the days the server allows', (t) => {
  t.is(periodUnits(LONGEST, INTERVALS_DAILY), 3660)
  t.true(isPeriod(LONGEST))
  t.false(isPeriod(TOO_LONG))
})

test('an address with a period that is too long opens without a period', (t) => {
  t.deepEqual(parse('?from=2026-10-01&to=2026-10-31').period, { from: '2026-10-01', to: '2026-10-31' })
  t.is(parse('?from=0001-01-01&to=2026-11-06').period, null)
  t.is(parse(`?from=${TOO_LONG.from}&to=${TOO_LONG.to}`).period, null)
})

test('a year still being typed is no period', (t) => {
  t.false(isPeriod({ from: '0002-10-01', to: '2026-10-31' }))
  t.false(isPeriod({ from: '', to: '2026-10-31' }))
})

test('a period that is too long gives a chart no bars of its own', (t) => {
  t.is(periodUnits({ from: '0001-01-01', to: '2026-11-06' }, INTERVALS_DAILY), undefined)
})

test('the bars of a period are named from its end', (t) => {
  const period = { from: '2026-01-15', to: '2026-03-31' }

  t.is(periodLabel(period, INTERVALS_DAILY, 0), '2026-03-31')
  t.is(periodLabel(period, INTERVALS_DAILY, 31), '2026-02-28')
  // The 31st does not spill over into the next month
  t.is(periodLabel(period, INTERVALS_MONTHLY, 1), '2026-02')
  t.is(periodLabel(period, INTERVALS_MONTHLY, 3), '2025-12')
  t.is(periodLabel(period, INTERVALS_YEARLY, 1), '2025')
})
