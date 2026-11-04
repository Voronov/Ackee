import test from 'ava'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import RendererCountries from '../../src/ui/scripts/components/renderers/RendererCountries.js'

const render = (sorting, items) =>
  renderToStaticMarkup(h(RendererCountries, { items, sorting, range: 'LAST_7_DAYS', setStatusLabel: () => {} }))

const NETHERLANDS = { code: 'NL', text: 'Netherlands', count: 3, date: null }

test('the top countries get a map above the list', (t) => {
  const markup = render('TOP', [NETHERLANDS])

  t.true(markup.includes('aria-label="Map of 1 country"'))
  t.true(markup.includes('Netherlands</span>'))
})

test('countries without a shape on the map get the list alone, not an empty map', (t) => {
  const markup = render('TOP', [
    { code: 'GI', text: 'Gibraltar', count: 3, date: null },
    { code: 'RE', text: 'Réunion', count: 1, date: null },
  ])

  t.false(markup.includes('role="img"'))
  t.true(markup.includes('Gibraltar</span>'))
})

test('new countries have no counts to colour by, so the list stays alone', (t) => {
  t.false(render('NEW', [NETHERLANDS]).includes('role="img"'))
})
