import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

const navigation = (page) => page.getByRole('navigation', { name: 'Main' })

const at = (path) => (url) => url.hash === `#${path}`

test('every section of the navigation opens its page and nothing leaves the origin', async ({ page, request }) => {
  const requests = []
  page.on('request', (sent) => requests.push(sent.url()))

  await createAccount(page, request, 'navigation')

  // Without a domain there is nothing to list
  await expect(navigation(page).getByRole('link', { name: 'Overview' })).toBeVisible()
  await expect(navigation(page).getByText('Domains')).toHaveCount(0)

  const domain = await createDomain(page, 'shop.test')
  // The domain was made through the API, the navigation reads the domains when the page loads
  await page.reload()
  await expect(navigation(page).getByText('Domains')).toBeVisible()

  const sections = [
    ['Overview', '/'],
    ['shop.test', `/domains/${domain.id}`],
    ['Traffic', '/insights/views'],
    ['Events', '/insights/events'],
    ['Live', '/insights/live'],
    ['Audience', '/insights/systems'],
    ['Settings', '/settings'],
  ]

  for (const [name, path] of sections) {
    const link = navigation(page).getByRole('link', { name, exact: true })
    await link.click()
    await expect(page).toHaveURL(at(path))
    await expect(link).toHaveAttribute('aria-current', 'page')
    await expect(navigation(page).locator('[aria-current]'), `only ${name} is current`).toHaveCount(1)
    await expect(page.locator('main')).not.toContainText('Loading')
  }

  await expect(page.getByRole('button', { name: 'New domain' })).toBeVisible()

  const origin = new URL(page.url()).origin
  const elsewhere = requests.filter((url) => url.startsWith('http') && new URL(url).origin !== origin)
  expect(elsewhere).toEqual([])
})

test('the tabs of Traffic and Audience switch the report and the address', async ({ page, request }) => {
  await createAccount(page, request, 'tabs')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/cart', { referrer: 'https://news.example/' })
  // The reports list the domains read when the page loads
  await page.reload()

  await navigation(page).getByRole('link', { name: 'Traffic' }).click()
  const traffic = page.getByRole('tablist', { name: 'Traffic' })
  await expect(traffic.getByRole('tab')).toHaveText([/^Views/, /^Pages/, /^Referrers/, /^Durations/])
  await expect(traffic.getByRole('tab', { name: 'Views' })).toHaveAttribute('aria-selected', 'true')

  await traffic.getByRole('tab', { name: 'Pages' }).click()
  await expect(page).toHaveURL(at('/insights/pages'))
  await expect(traffic.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true')
  await expect(traffic.getByRole('tab', { name: 'Views' })).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('main')).toContainText('http://shop.test/cart')
  await expect(navigation(page).getByRole('link', { name: 'Traffic' })).toHaveAttribute('aria-current', 'page')

  // The arrows move between the tabs and take the focus with them
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(at('/insights/referrers'))
  await expect(traffic.getByRole('tab', { name: 'Referrers' })).toBeFocused()
  await expect(page.locator('main')).toContainText('news.example')
  await expect(page.locator('main')).not.toContainText('http://shop.test/cart')

  await page.keyboard.press('End')
  await expect(page).toHaveURL(at('/insights/durations'))
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(at('/insights/views'))
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(at('/insights/durations'))

  // A tab is a page of the history like any other
  await page.goBack()
  await expect(page).toHaveURL(at('/insights/views'))
  await expect(traffic.getByRole('tab', { name: 'Views' })).toHaveAttribute('aria-selected', 'true')

  // The open tab, clicked or reached again with Home, adds no page to the history
  await traffic.getByRole('tab', { name: 'Views' }).click()
  await page.keyboard.press('Home')
  await page.goBack()
  await expect(page).toHaveURL(at('/insights/durations'))
  await page.goForward()
  await expect(page).toHaveURL(at('/insights/views'))

  await navigation(page).getByRole('link', { name: 'Audience' }).click()
  const audience = page.getByRole('tablist', { name: 'Audience' })
  await expect(audience.getByRole('tab')).toHaveText(['Systems', 'Devices', 'Browsers', 'Sizes', 'Languages'])
  await expect(traffic).toHaveCount(0)

  await audience.getByRole('tab', { name: 'Languages' }).click()
  await expect(page).toHaveURL(at('/insights/languages'))
  await expect(audience.getByRole('tab', { name: 'Languages' })).toHaveAttribute('aria-selected', 'true')
  await expect(navigation(page).getByRole('link', { name: 'Audience' })).toHaveAttribute('aria-current', 'page')
  await expect(navigation(page).getByRole('link', { name: 'Traffic' })).not.toHaveAttribute('aria-current')

  // Pages without related reports have no tabs
  await navigation(page).getByRole('link', { name: 'Events' }).click()
  await expect(page.getByRole('tablist')).toHaveCount(0)
})

test('a deep link and the keys of v1.0 still lead to their reports', async ({ page, request }) => {
  await createAccount(page, request, 'deep-link')

  await page.goto('/#/insights/referrers')
  await expect(navigation(page).getByRole('link', { name: 'Traffic' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('tab', { name: 'Referrers' })).toHaveAttribute('aria-selected', 'true')

  for (const [key, path] of [
    ['v', '/insights/views'],
    ['p', '/insights/pages'],
    ['l', '/insights/live'],
    ['s', '/settings'],
  ]) {
    await page.keyboard.press(key)
    await expect(page, `the key ${key}`).toHaveURL(at(path))
  }
})

test('on a phone the navigation is a menu over the content', async ({ page, request }) => {
  await createAccount(page, request, 'menu')

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/insights/views')

    const menu = page.getByRole('button', { name: 'Menu' })
    const live = navigation(page).getByRole('link', { name: 'Live' })
    await expect(live).toBeHidden()

    await menu.click()
    await expect(menu).toHaveAttribute('aria-expanded', 'true')
    await expect(live).toBeVisible()
    const panel = await navigation(page).boundingBox()
    expect(panel.x + panel.width, `the menu at ${width} px`).toBeLessThanOrEqual(width)

    await page.keyboard.press('Escape')
    await expect(live).toBeHidden()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toBeFocused()

    // A click next to the menu closes it too
    await menu.click()
    await expect(live).toBeVisible()
    await page.mouse.click(width - 10, 400)
    await expect(live).toBeHidden()

    // Tab stays out of the content under the backdrop while the menu is open
    await menu.click()
    await navigation(page).getByRole('link', { name: 'Settings' }).focus()
    for (const step of [1, 2, 3]) {
      await page.keyboard.press('Tab')
      const inContent = await page.evaluate(() => document.activeElement.closest('main, .filter') != null)
      expect(inContent, `Tab ${step} from the last link at ${width} px`).toBe(false)
    }
    await page.keyboard.press('Escape')

    // The picked link hides with the menu, so the focus goes on to the page it opened
    await menu.click()
    await live.click()
    await expect(page).toHaveURL(at('/insights/live'))
    await expect(live).toBeHidden()
    await expect(page.locator('main')).toBeFocused()
  }

  // A wider screen, like a phone turned on its side, puts the menu away and gives the page back
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/insights/views')
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(navigation(page).getByRole('link', { name: 'Live' })).toBeVisible()
  await page.setViewportSize({ width: 1024, height: 844 })

  // The button is not shown on a wide screen, so it is found by what it controls
  await expect(page.locator('[aria-controls="navigation"]')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('main')).not.toHaveAttribute('inert')
  await navigation(page).getByRole('link', { name: 'Settings' }).focus()
  await page.keyboard.press('Tab')
  expect(
    await page.evaluate(() => document.activeElement.closest('main') != null),
    'Tab goes on into the content',
  ).toBe(true)
  await page.getByRole('tab', { name: 'Pages' }).click()
  await expect(page).toHaveURL(at('/insights/pages'))
})
