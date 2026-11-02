import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import signale from '../src/utils/signale.js'

/*
 * Writes the map of the Countries report (ACKEE-20) into src/ui/scripts/constants/worldMap.js:
 * one SVG path per ISO 3166-1 alpha-2 code. The map ships with the interface, so the report
 * never loads tiles or data from anywhere else. Run it only when the source changes:
 *
 *   node scripts/world-map.js [directory with the two files of SOURCES]
 *
 * Without a directory the pinned release is downloaded from GitHub and checked against its hashes.
 * Source: Natural Earth, Admin 0 countries and tiny countries 1:110m, public domain
 * (naturalearthdata.com).
 */
const RELEASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson'
const SOURCES = {
  countries: {
    file: 'ne_110m_admin_0_countries.geojson',
    sha256: '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f',
  },
  tiny: {
    file: 'ne_110m_admin_0_tiny_countries.geojson',
    sha256: '753c4b167361f0f1223091d52f98aaddfb9101529eef263cc094057e43228c40',
  },
}
const TARGET = path.resolve(import.meta.dirname, '../src/ui/scripts/constants/worldMap.js')

// Width of the land in the units of the paths; the browser scales the picture to the card
const LAND_WIDTH = 1000

// Radius of the dot of a country too small for an outline at this scale
const DOT = 3

// Natural Earth leaves a code out for areas whose status is disputed. The address database
// reports them under these codes, so they are drawn as part of that country.
const CODES_BY_NAME = {
  'N. Cyprus': 'CY',
  'Somaliland': 'SO',
}

// Natural Earth draws the de facto line by default, which puts Crimea in Russia. Ukraine's
// borders are the ones recognised by the UN, so the polygon that holds this point moves.
const MOVES = [{ point: [34.1, 44.9], from: 'RU', to: 'UA' }]

// Nobody visits from Antarctica, and it would take a fifth of the height of the map
const LEFT_OUT = new Set(['AQ'])

// Countries that neither file draws at 1:110m, as a dot on the capital
const EXTRA_DOTS = {
  AD: [1.52, 42.51],
  AG: [-61.8, 17.07],
  DM: [-61.37, 15.41],
  GD: [-61.68, 12.12],
  HK: [114.17, 22.32],
  KN: [-62.75, 17.33],
  LC: [-60.98, 13.91],
  LI: [9.52, 47.14],
  MC: [7.42, 43.74],
  MO: [113.54, 22.19],
  SM: [12.45, 43.94],
  VA: [12.45, 41.9],
  VC: [-61.2, 13.25],
}

const load = async (directory, { file, sha256 }) => {
  if (directory != null) return JSON.parse(await readFile(path.join(directory, file), 'utf8'))

  const response = await fetch(`${RELEASE}/${file}`)
  if (response.ok === false) throw new Error(`Natural Earth answered ${response.status} for ${file}`)

  const text = await response.text()
  const hash = createHash('sha256').update(text).digest('hex')
  if (hash !== sha256) throw new Error(`${file} has hash ${hash}, expected ${sha256}`)

  return JSON.parse(text)
}

const codeOf = (properties) => {
  const code = properties.ISO_A2_EH
  return /^[A-Z]{2}$/.test(code) ? code : CODES_BY_NAME[properties.NAME]
}

const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)

// GeoJSON repeats the first point of a ring at its end
const open = (ring) => ring.slice(0, -1)

const isInside = ([x, y], ring) => {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index]
    const [xj, yj] = ring[previous]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const key = (point) => point.join(',')

const rotate = (ring, start) => [...ring.slice(start), ...ring.slice(0, start)]

/*
 * Joins two outer rings that share one run of points, so the shared edge is not drawn as a
 * border inside a country. Returns null when the rings do not touch that way.
 */
export const mergeRings = (a, b) => {
  const inB = new Set(b.map(key))
  const shared = a.map((point) => inB.has(key(point)))
  const count = shared.filter(Boolean).length
  if (count < 2 || count === a.length) return null

  // Start a right after its shared run, so the run ends the ring
  const start = shared.findIndex((isShared, index) => isShared === false && shared.at(index - 1) === true)
  const rotated = rotate(a, start)
  const runStart = rotated.findIndex((point, index) => shared[(index + start) % a.length])
  if (rotated.slice(runStart).some((point) => inB.has(key(point)) === false)) return null

  const first = key(rotated[runStart])
  const last = key(rotated.at(-1))
  const keep = rotated.slice(0, runStart + 1)

  // The other ring walks the shared run the other way: from its first point, walk on to its last
  const firstInB = b.findIndex((point) => key(point) === first)
  const walked = rotate(b, firstInB)
  const forward = key(walked[1]) === key(rotated[runStart + 1]) ? [walked[0], ...walked.slice(1).toReversed()] : walked
  const lastInB = forward.findIndex((point) => key(point) === last)

  return [...keep, ...forward.slice(1, lastInB + 1)]
}

const mergeAll = (polygons) => {
  const result = [...polygons]
  for (let index = 0; index < result.length; index++) {
    for (let other = index + 1; other < result.length; other++) {
      const merged = mergeRings(result[index][0], result[other][0])
      if (merged == null) continue

      result[index] = [merged, ...result[index].slice(1), ...result[other].slice(1)]
      result.splice(other, 1)
      other = index
    }
  }
  return result
}

/*
 * The Natural Earth projection (Šavrič, Jenny, Patterson and Jenny, 2011): rounder than plain
 * longitude and latitude, without the size of Greenland that Mercator gives it.
 */
export const project = ([longitude, latitude]) => {
  const lambda = (longitude * Math.PI) / 180
  const phi = (latitude * Math.PI) / 180
  const phi2 = phi * phi
  const phi4 = phi2 * phi2

  return [
    lambda * (0.8707 - 0.131_979 * phi2 + phi4 * (-0.013_791 + phi4 * (0.003_971 * phi2 - 0.001_529 * phi4))),
    phi * (1.007_226 + phi2 * (0.015_085 + phi4 * (-0.044_475 + 0.028_874 * phi2 - 0.005_916 * phi4))),
  ]
}

// One subpath per ring: an absolute start, then short relative steps. A ring that rounds to
// fewer than three points has no area to draw, and an empty "l" breaks the whole path.
export const pathOf = (rings) =>
  rings
    .map((ring) => {
      const steps = []
      let [x, y] = ring[0]
      for (const [nextX, nextY] of ring.slice(1)) {
        if (nextX === x && nextY === y) continue
        steps.push(`${nextX - x} ${nextY - y}`)
        x = nextX
        y = nextY
      }
      if (new Set(ring.map(key)).size < 3 || steps.length === 0) return ''

      return `M${ring[0][0]} ${ring[0][1]}l${steps.join(' ')}z`.replaceAll(' -', '-')
    })
    .join('')

const dotOf = ([x, y]) => `M${x - DOT} ${y}a${DOT} ${DOT} 0 1 0 ${2 * DOT} 0a${DOT} ${DOT} 0 1 0 ${-2 * DOT} 0z`

export const build = ({ countries: outlines, tiny }) => {
  const countries = new Map()
  const add = (code, polygon) => countries.set(code, [...(countries.get(code) ?? []), polygon])

  for (const feature of outlines.features) {
    const code = codeOf(feature.properties)
    if (code == null || LEFT_OUT.has(code)) continue

    for (const polygon of polygonsOf(feature.geometry)) {
      const move = MOVES.find((entry) => entry.from === code && isInside(entry.point, polygon[0]))
      add(move?.to ?? code, polygon.map(open))
    }
  }

  // A tiny country gets a dot unless it already has an outline, like the Azores of Portugal
  const dots = new Map(Object.entries(EXTRA_DOTS).filter(([code]) => countries.has(code) === false))
  for (const feature of tiny.features) {
    const code = codeOf(feature.properties)
    if (code != null && countries.has(code) === false) dots.set(code, feature.geometry.coordinates)
  }

  const projected = [...countries].map(([code, polygons]) => [
    code,
    mergeAll(polygons).map((polygon) => polygon.map((ring) => ring.map(project))),
  ])

  const points = projected.flatMap(([, polygons]) => polygons.flatMap((polygon) => polygon.flat()))
  const minX = Math.min(...points.map(([x]) => x))
  const maxX = Math.max(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  const maxY = Math.max(...points.map(([, y]) => y))
  const scale = LAND_WIDTH / (maxX - minX)

  // SVG counts y downward. The margin keeps the dots at the edges inside the picture.
  const toView = ([x, y]) => [Math.round((x - minX) * scale) + DOT, Math.round((maxY - y) * scale) + DOT]

  const byCode = ([a], [b]) => a.localeCompare(b)

  // Dots come last, so they are drawn on top of the countries around them
  const paths = Object.fromEntries([
    ...projected
      .map(([code, polygons]) => {
        const path = polygons.map((polygon) => pathOf(polygon.map((ring) => ring.map(toView)))).join('')
        // A country whose every ring rounds away still gets a dot, so it never vanishes
        return [code, path === '' ? dotOf(toView(polygons[0][0][0])) : path]
      })
      .toSorted(byCode),
    ...[...dots].map(([code, point]) => [code, dotOf(toView(project(point)))]).toSorted(byCode),
  ])

  return { width: LAND_WIDTH + 2 * DOT, height: Math.round((maxY - minY) * scale) + 2 * DOT, paths }
}

const source = ({ width, height, paths }) => `
// Generated by scripts/world-map.js, do not edit. Natural Earth 1:110m countries, public domain
// (naturalearthdata.com), in the Natural Earth projection. Crimea is part of Ukraine. Countries
// too small for an outline are dots.
export const WIDTH = ${width}
export const HEIGHT = ${height}

export default ${JSON.stringify(paths)}
`

const run = async () => {
  const directory = process.argv[2]
  const map = build({
    countries: await load(directory, SOURCES.countries),
    tiny: await load(directory, SOURCES.tiny),
  })
  // Only for writing, so the tests of the build do not load it
  const prettier = await import('prettier')
  const options = await prettier.resolveConfig(TARGET)
  await writeFile(TARGET, await prettier.format(source(map), { ...options, filepath: TARGET }))

  signale.success(`${Object.keys(map.paths).length} countries written to ${path.relative(process.cwd(), TARGET)}`)
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename

if (isMain) {
  run().catch((error) => {
    signale.fatal(error)
    process.exit(1)
  })
}
