import test from 'ava'

import mapShade, { MIN_SHADE } from '../../src/ui/scripts/utils/mapShade.js'

test('the country with the most visits is the fullest colour', (t) => {
  t.is(mapShade(40, 40), 1)
})

test('a country with a few visits stays visible next to one with thousands', (t) => {
  const shade = mapShade(1, 10_000)

  t.true(shade > MIN_SHADE)
  t.true(shade < 0.3)
})

test('more visits give a fuller colour', (t) => {
  const shades = [1, 5, 20, 100].map((count) => mapShade(count, 100))

  t.deepEqual(
    shades,
    shades.toSorted((a, b) => a - b),
  )
  t.is(new Set(shades).size, shades.length)
})

test('nothing to compare with gives the lightest colour, not NaN', (t) => {
  t.is(mapShade(0, 0), MIN_SHADE)
  t.is(mapShade(3, 0), MIN_SHADE)
})
