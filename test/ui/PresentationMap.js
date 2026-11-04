import test from 'ava'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import PresentationMap from '../../src/ui/scripts/components/presentations/PresentationMap.js'
import paths from '../../src/ui/scripts/constants/worldMap.js'

const render = (items) => {
  const markup = renderToStaticMarkup(h(PresentationMap, { items }))
  const visited = [...markup.matchAll(/<path class="map__country map__country--visited"[^>]*data-code="(\w+)"/g)]

  return { markup, visited: visited.map((match) => match[1]) }
}

test('only the countries with visits are coloured', (t) => {
  const { markup, visited } = render([
    { code: 'NL', text: 'Netherlands', count: 3 },
    { code: 'UA', text: 'Ukraine', count: 1 },
  ])

  t.deepEqual(visited, ['NL', 'UA'])
  t.is((markup.match(/<path /g) ?? []).length, Object.keys(paths).length)
  t.true(markup.includes('<title>Netherlands: 3</title>'))
})

test('the map tells a screen reader how many countries it shows', (t) => {
  t.true(render([{ code: 'NL', text: 'Netherlands', count: 3 }]).markup.includes('aria-label="Map of 1 country"'))
})

test('a country without a code or without a shape is left to the list', (t) => {
  const { markup, visited } = render([
    { code: 'NL', text: 'Netherlands', count: 3 },
    { code: null, text: '(not set)', count: 9 },
    { code: 'XX', text: 'XX', count: 2 },
  ])

  t.deepEqual(visited, ['NL'])
  t.true(markup.includes('aria-label="Map of 1 country"'))
})

test('common countries of visitors have a shape, the small ones as a dot', (t) => {
  for (const code of ['UA', 'US', 'DE', 'NL', 'GB', 'FR', 'PL', 'CN', 'IN', 'BR', 'SG', 'HK', 'LU', 'MT', 'XK'])
    t.truthy(paths[code], code)
})
