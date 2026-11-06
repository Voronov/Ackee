import { readFile } from 'node:fs/promises'

import test from 'ava'

const theme = await readFile(new URL('../../src/ui/styles/_theme.scss', import.meta.url), 'utf8')
const dark = theme.slice(theme.indexOf('@mixin dark'), theme.indexOf('@mixin light'))

const token = (name) => new RegExp(`--${name}: ([^;]+);`).exec(dark)[1]
const color = (name) =>
  token(name)
    .match(/[\d.]+/g)
    .map(Number)

const over = ([r, g, b, alpha], below) => [r, g, b].map((value, index) => value * alpha + below[index] * (1 - alpha))
const fade = ([r, g, b, alpha], opacity) => [r, g, b, alpha * opacity]

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (text, behind) => {
  const [lighter, darker] = [luminance(over(text, behind)), luminance(behind)].toSorted((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

test('every text of the dark theme keeps 4.5:1 on its background', (t) => {
  const tint = Number.parseFloat(token('tint')) / 100
  const faded = Number(token('faded'))
  const hover = (behind) => over(color('dimmed'), behind)
  const badge = (name, behind) => over(fade(color(name), tint), behind)

  const page = over(color('black'), [0, 0, 0])
  const card = over(color('card'), [0, 0, 0])
  const menu = over(color('context-solid'), card)

  const pairs = {
    'light on the page': ['light', page],
    'light on a card': ['light', card],
    'light on a row of a card': ['light', hover(card)],
    'light on a filter of the page': ['light', hover(page)],
    'light on a menu': ['light', menu],
    'light on a key hint of a hovered menu entry': ['light', hover(hover(menu))],
    'primary on a hovered menu entry': ['primary', hover(menu)],
    'destructive on a card': ['destructive', card],
    'destructive on a hovered button': ['destructive', hover(card)],
    'positive badge': ['primary', badge('primary', card)],
    'negative badge': ['negative', badge('negative', card)],
    'neutral badge': ['light', badge('white', card)],
  }

  for (const [name, [text, behind]] of Object.entries(pairs)) {
    t.true(contrast(color(text), behind) >= 4.5, name)
  }

  t.true(contrast(fade(color('light'), faded), page) >= 4.5, 'a faded note on the page')
  t.true(contrast(fade(color('light'), faded), hover(card)) >= 4.5, 'a faded text on a row of a card')
})
