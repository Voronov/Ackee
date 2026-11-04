import { createElement as h, useState } from 'react'

import { THEME_AUTO, THEME_DARK, THEME_LIGHT, getTheme, setTheme } from '../../utils/theme.js'
import Label from '../Label.js'
import Select from '../Select.js'
import CardSetting from './CardSetting.js'

const ITEMS = [
  { value: THEME_AUTO, label: 'Auto (as the system)' },
  { value: THEME_LIGHT, label: 'Light' },
  { value: THEME_DARK, label: 'Dark' },
]

// The theme is a choice of this browser, so it stays after a sign-out
const CardTheme = () => {
  const [theme, setThemeState] = useState(getTheme)

  return h(
    CardSetting,
    {
      headline: 'Appearance',
    },
    h(Label, { htmlFor: 'theme-select' }, 'Theme'),
    h(Select, {
      id: 'theme-select',
      value: theme,
      items: ITEMS,
      onChange: (event) => setThemeState(setTheme(event.target.value)),
    }),
  )
}

export default CardTheme
