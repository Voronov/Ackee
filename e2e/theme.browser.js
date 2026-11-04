import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

// The background of the page in each theme, see src/ui/styles/_theme.scss
const DARK = 'rgb(40, 45, 45)'
const LIGHT = 'rgb(240, 242, 242)'

const ROUTES = [
  '',
  'insights/views',
  'insights/pages',
  'insights/referrers',
  'insights/durations',
  'insights/events',
  'insights/live',
  'insights/systems',
  'insights/devices',
  'insights/browsers',
  'insights/sizes',
  'insights/languages',
  'insights/countries',
  'settings',
]

const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

const open = async (page, route) => {
  await page.goto(`/#/${route}`)
  await expect(page.locator('main')).not.toContainText('Loading')
}

// Texts below 4.5:1 (3:1 for large text), WCAG AA. The background is the colours of the
// element and its parents laid over each other. Texts over an image or a gradient, and texts
// that are faded out on purpose (disabled, hidden), are left out: their background is unknown.
const lowContrast = (page, selector = 'body *') =>
  page.evaluate((selector) => {
    const parse = (value) => {
      const numbers = (value.match(/-?[\d.]+/g) ?? []).map(Number)
      const scale = value.startsWith('color(') ? 255 : 1
      return [numbers[0] * scale, numbers[1] * scale, numbers[2] * scale, numbers[3] ?? 1]
    }

    const over = (top, bottom) => [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3]))

    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((value) => {
        const channel = value / 255
        return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    const backgroundOf = (element) => {
      const layers = []
      for (let node = element; node != null; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.backgroundImage !== 'none') return
        if (Number(style.opacity) < 1) return
        layers.push(parse(style.backgroundColor))
      }

      return layers.reduceRight((below, layer) => over(layer, below), [255, 255, 255])
    }

    const hasText = (element) =>
      [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '')

    return [...document.querySelectorAll(selector)]
      .filter((element) => hasText(element) && element.getClientRects().length > 0)
      .filter((element) => getComputedStyle(element).visibility === 'visible')
      .flatMap((element) => {
        const behind = backgroundOf(element)
        if (behind == null) return []

        const style = getComputedStyle(element)
        const front = over(parse(style.color), behind)
        const [lighter, darker] = [luminance(front), luminance(behind)].toSorted((a, b) => b - a)
        const ratio = (lighter + 0.05) / (darker + 0.05)

        const size = Number.parseFloat(style.fontSize)
        const isLarge = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
        if (ratio >= (isLarge ? 3 : 4.5)) return []

        const text = element.textContent.trim().slice(0, 30)
        return [`${element.tagName.toLowerCase()}.${element.className} "${text}" ${ratio.toFixed(2)}`]
      })
  }, selector)

test('the theme follows the system until one is chosen in Settings, and the choice stays after a reload', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await createAccount(page, request, 'theme')
  expect(await background(page)).toBe(LIGHT)

  // The system changes, the page follows without a reload
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await background(page)).toBe(DARK)

  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Theme').selectOption('light')
  expect(await background(page)).toBe(LIGHT)

  await page.reload()
  await expect(page.getByLabel('Theme')).toHaveValue('light')
  expect(await background(page)).toBe(LIGHT)

  await page.getByLabel('Theme').selectOption('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  expect(await background(page)).toBe(DARK)

  // Auto hands the choice back to the system
  await page.getByLabel('Theme').selectOption('auto')
  expect(await background(page)).toBe(LIGHT)
  expect(await page.evaluate(() => localStorage.getItem('ackee_theme'))).toBeNull()
})

test('the chosen theme is set before the scripts of the page run, so the page does not flash', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await createAccount(page, request, 'theme-early')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Theme').selectOption('light')

  // Without the bundle only index.html and the styles are left to set the theme
  await page.route('**/index.js', (route) => route.abort())
  await page.reload()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await background(page)).toBe(LIGHT)
})

test('every text of every page keeps a contrast of 4.5:1 in the light theme', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await createAccount(page, request, 'theme-contrast')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/', { referrer: 'https://news.example/' })
  await sendView(request, domain, '/cart', { visitor: 1 })
  await page.reload()

  for (const route of ROUTES) {
    await open(page, route)
    expect(await lowContrast(page), `/#/${route}`).toEqual([])
  }

  // A dialog, over the page
  await page.getByRole('button', { name: 'New domain' }).click()
  // Once it has faded in, as the faded texts are left out
  await expect(page.locator('.modal.visible')).toHaveCSS('opacity', '1')
  expect(await lowContrast(page, '.modal *'), 'the dialog of a new domain').toEqual([])
})

test('the headings of the navigation keep a contrast of 4.5:1 in both themes', async ({ page, request }) => {
  await createAccount(page, request, 'theme-headings')
  await createDomain(page, 'shop.test')

  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await page.reload()
    await expect(page.locator('.navigation__heading').first()).toBeVisible()
    expect(await lowContrast(page, '.navigation__heading'), colorScheme).toEqual([])
  }
})
