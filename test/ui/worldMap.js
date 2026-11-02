import test from 'ava'

import paths, { HEIGHT, WIDTH } from '../../src/ui/scripts/constants/worldMap.js'

const NUMBER = /-?\d+/g
const OUTLINE = /^M(-?\d+) (-?\d+)l([\d -]+)z$/
const DOT = /^M(-?\d+) (-?\d+)a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z$/

// A path the browser cannot read is dropped whole, with an error in the console
test('every path of the map is valid SVG path data inside the picture', (t) => {
  for (const [code, path] of Object.entries(paths)) {
    for (const subpath of path.split(/(?=M)/)) {
      const outline = OUTLINE.exec(subpath)
      const dot = DOT.exec(subpath)
      t.true(outline != null || dot != null, `${code}: ${subpath.slice(0, 40)}`)

      const [, x, y] = outline ?? dot
      t.true(x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT, `${code} starts at ${x} ${y}`)

      // Every relative step is a pair of numbers, and there is at least one
      if (outline != null) {
        const steps = outline[3].match(NUMBER)
        t.true(steps.length >= 4 && steps.length % 2 === 0, `${code}: ${steps.length} numbers`)
      }
    }
  }
})
