import test from 'ava'

import { build, mergeRings, pathOf } from '../../scripts/world-map.js'

const feature = (properties, coordinates) => ({
  type: 'Feature',
  properties: { NAME: properties.NAME ?? properties.ISO_A2_EH, ...properties },
  geometry: { type: 'MultiPolygon', coordinates },
})

// Closed squares, counter-clockwise like Natural Earth's outer rings
const square = (x, y, size = 1) => [
  [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ],
]

const subpaths = (path) => path.match(/M/g).length

const source = (features, tiny = []) => ({
  countries: { type: 'FeatureCollection', features },
  tiny: { type: 'FeatureCollection', features: tiny },
})

test('two rings that share an edge become one, without the edge', (t) => {
  const left = square(0, 0)[0].slice(0, -1)
  const right = square(1, 0)[0].slice(0, -1)

  // Where the merged ring starts does not matter, so it is read from its lowest corner
  const merged = mergeRings(left, right)
  const start = merged.findIndex(([x, y]) => x === 0 && y === 0)

  t.deepEqual(
    [...merged.slice(start), ...merged.slice(0, start)],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [0, 1],
    ],
  )
})

test('rings that do not share an edge stay apart', (t) => {
  t.is(mergeRings(square(0, 0)[0].slice(0, -1), square(5, 5)[0].slice(0, -1)), null)
})

test('Crimea is drawn as part of Ukraine, in one outline with it', (t) => {
  const { paths } = build(
    source([
      // Russia's Crimea polygon touches Ukraine along an edge, the way Natural Earth draws it
      feature({ ISO_A2_EH: 'RU' }, [square(34, 44), square(40, 50, 10)]),
      feature({ ISO_A2_EH: 'UA' }, [square(34, 45)]),
    ]),
  )

  t.is(subpaths(paths.RU), 1)
  t.is(subpaths(paths.UA), 1)
})

test('areas without a code join their country, and Antarctica is left out', (t) => {
  const { paths } = build(
    source([
      feature({ ISO_A2_EH: 'CY' }, [square(32, 34)]),
      feature({ ISO_A2_EH: '-99', NAME: 'N. Cyprus' }, [square(33, 34)]),
      feature({ ISO_A2_EH: 'AQ' }, [square(0, -80, 20)]),
    ]),
  )

  // Every other path is one of the dots of the small countries
  t.deepEqual(
    Object.keys(paths).filter((code) => paths[code].includes('a') === false),
    ['CY'],
  )
  t.is(subpaths(paths.CY), 1)
  t.is(paths.AQ, undefined)
})

test('a tiny country gets a dot, drawn after the outlines, unless it has an outline', (t) => {
  const point = (code, coordinates) => ({
    type: 'Feature',
    properties: { ISO_A2_EH: code, NAME: code },
    geometry: { type: 'Point', coordinates },
  })
  const { paths } = build(
    source(
      [feature({ ISO_A2_EH: 'PT' }, [square(-9, 38)]), feature({ ISO_A2_EH: 'MY' }, [square(101, 3)])],
      [point('SG', [103.8, 1.35]), point('PT', [-28, 38.5])],
    ),
  )

  const codes = Object.keys(paths)
  t.true(paths.SG.includes('a'))
  t.is(subpaths(paths.PT), 1)
  t.true(codes.indexOf('SG') > codes.indexOf('PT'))
  t.true(codes.indexOf('SG') > codes.indexOf('MY'))
})

test('a ring that rounds to a point is left out instead of an empty subpath', (t) => {
  const point = [
    [839, 120],
    [839, 120],
    [839, 120],
  ]
  const island = [
    [838, 120],
    [839, 120],
    [839, 121],
  ]

  t.is(pathOf([point]), '')
  t.is(pathOf([point, island]), 'M838 120l1 0 0 1z')
})

test('a country whose every ring rounds away is still drawn, as a dot', (t) => {
  // The big country sets the scale, as the whole world does
  const { paths } = build(
    source([
      feature({ ISO_A2_EH: 'BR' }, [square(-60, -20, 60)]),
      feature({ ISO_A2_EH: 'LU' }, [square(6.1, 49.6, 0.0001)]),
    ]),
  )

  t.true(paths.BR.includes('l'))

  t.regex(paths.LU, /^M\d+ \d+a/)
})
