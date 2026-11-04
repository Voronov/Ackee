import createStorage from './createStorage.js'

export const THEME_AUTO = 'auto'
export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'

// The same key is read by the script in src/utils/layout.js before the first paint
export const THEME_KEY = 'ackee_theme'

const storage = createStorage(THEME_KEY, THEME_AUTO)

export const getTheme = () => {
  try {
    const theme = storage.get()
    return theme === THEME_LIGHT || theme === THEME_DARK ? theme : THEME_AUTO
  } catch {
    // Blocked storage or a value that is not JSON
    return THEME_AUTO
  }
}

// Auto removes the attribute, so the media query of the styles decides
export const setTheme = (theme, root = document.documentElement) => {
  if (theme === THEME_LIGHT || theme === THEME_DARK) {
    storage.set(theme)
    root.dataset.theme = theme
    return theme
  }

  storage.reset()
  delete root.dataset.theme
  return THEME_AUTO
}
