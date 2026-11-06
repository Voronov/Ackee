import test from 'ava'

import { INTERVALS_DAILY, INTERVALS_MONTHLY, INTERVALS_YEARLY } from '../../src/constants/intervals.js'
import { FILTER_VALUE_MAX_LENGTH, FILTERS_MAX } from '../../src/constants/filters.js'
import {
  exportParameters,
  isFilter,
  isPeriod,
  parse,
  periodLabel,
  periodUnits,
} from '../../src/ui/scripts/hooks/useScope.js'

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

test('a day that is not in the calendar is no period', (t) => {
  t.false(isPeriod({ from: '2026-02-01', to: '2026-02-31' }))
  t.false(isPeriod({ from: '2026-02-29', to: '2026-03-01' }))
  t.false(isPeriod({ from: '2026-04-01', to: '2026-04-31' }))
  t.false(isPeriod({ from: '2026-13-01', to: '2026-13-02' }))
  t.false(isPeriod({ from: '2026-01-00', to: '2026-01-02' }))
  t.false(isPeriod({ from: '0000-01-01', to: '0000-01-31' }))
  t.false(isPeriod({ from: '1900-02-29', to: '1900-03-01' }))
  t.true(isPeriod({ from: '2024-02-29', to: '2024-03-01' }))
  t.true(isPeriod({ from: '2000-02-29', to: '2000-03-01' }))
})

test('a filter the server would refuse is dropped from the address', (t) => {
  const fits = 'a'.repeat(FILTER_VALUE_MAX_LENGTH)

  t.deepEqual(parse('?filter=FOO:bar').filters, [])
  t.deepEqual(parse('?filter=__proto__:x&filter=constructor:x&filter=').filters, [])
  t.deepEqual(parse(`?filter=SITE_LOCATION:${fits}a`).filters, [])
  t.deepEqual(parse(`?filter=SITE_LOCATION:${fits}`).filters, [{ field: 'SITE_LOCATION', value: fits }])
  t.deepEqual(parse('?filter=FOO:bar&filter=COUNTRY:UA').filters, [{ field: 'COUNTRY', value: 'UA' }])
  t.deepEqual(parse('?filter=SITE_REFERRER').filters, [{ field: 'SITE_REFERRER', value: null }])
})

test('an address keeps as many filters as the server takes', (t) => {
  const search = Array.from({ length: FILTERS_MAX + 1 }, (_, index) => `filter=COUNTRY:${index}`).join('&')

  t.is(parse(`?${search}`).filters.length, FILTERS_MAX)
})

test('a value too long for the server makes no filter', (t) => {
  t.true(isFilter({ field: 'SITE_LOCATION', value: 'a'.repeat(FILTER_VALUE_MAX_LENGTH) }))
  t.false(isFilter({ field: 'SITE_LOCATION', value: 'a'.repeat(FILTER_VALUE_MAX_LENGTH + 1) }))
  t.true(isFilter({ field: 'SITE_LOCATION', value: null }))
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

test('the scope goes to the export as it stands in the address', (t) => {
  const scope = parse('?filter=SITE_REFERRER&filter=COUNTRY:UA&from=2026-10-01&to=2026-10-31')

  t.deepEqual(exportParameters(scope), {
    filter: ['SITE_REFERRER', 'COUNTRY:UA'],
    from: '2026-10-01',
    to: '2026-10-31',
  })
  t.deepEqual(exportParameters(parse('')), { filter: [], from: undefined, to: undefined })
})
