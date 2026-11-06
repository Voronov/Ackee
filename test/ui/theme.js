import test from 'ava'

import { THEME_AUTO, THEME_DARK, THEME_LIGHT, getTheme, setTheme } from '../../src/ui/scripts/utils/theme.js'

const storage = new Map()

test.before(() => {
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
})

test.beforeEach(() => storage.clear())

const root = () => ({ dataset: {} })

test.serial('without a choice the theme is auto', (t) => {
  t.is(getTheme(), THEME_AUTO)
})

test.serial('a chosen theme is saved and set on the page', (t) => {
  const element = root()

  t.is(setTheme(THEME_LIGHT, element), THEME_LIGHT)
  t.is(element.dataset.theme, 'light')
  t.is(getTheme(), THEME_LIGHT)
  // The script of index.html reads it with JSON.parse
  t.is(JSON.parse(storage.get('ackee_theme')), 'light')
})

test.serial('auto forgets the choice and leaves the page to the system', (t) => {
  const element = root()
  setTheme(THEME_DARK, element)

  t.is(setTheme(THEME_AUTO, element), THEME_AUTO)
  t.is(element.dataset.theme, undefined)
  t.false(storage.has('ackee_theme'))
})

test.serial('an unknown or broken saved value reads as auto', (t) => {
  storage.set('ackee_theme', JSON.stringify('purple'))
  t.is(getTheme(), THEME_AUTO)

  storage.set('ackee_theme', '{not json')
  t.is(getTheme(), THEME_AUTO)
})
