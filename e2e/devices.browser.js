import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

const navigation = (page) => page.getByRole('navigation', { name: 'Main' })

// On a phone the navigation sits behind the Menu button
const go = async (page, name) => {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const phone = await menu.isVisible()
  if (phone) await menu.click()
  await navigation(page).getByRole('link', { name }).click()
  // Choosing a section closes the menu, so the page is not hidden behind it
  if (phone) await expect(navigation(page)).toBeHidden()
}

// The icons of the made-up referrers cannot load: there is no news.example
const isNoise = (text) => /\.example|ERR_NAME_NOT_RESOLVED/.test(text)

// Elements that reach past the right edge of the window, outside a row that scrolls on its own,
// and whether the page itself scrolls sideways: what a phone would show as a broken layout
const overflowing = (page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const scrolls = (element) => {
      for (let node = element.parentElement; node != null; node = node.parentElement) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(node).overflowX)) return true
      }
      return false
    }
    const elements = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return (
          box.width > 0 &&
          box.right > width + 1 &&
          getComputedStyle(element).position !== 'fixed' &&
          scrolls(element) === false
        )
      })
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]} ${Math.round(element.getBoundingClientRect().right)}px`,
      )
    const page =
      document.documentElement.scrollWidth > width + 1
        ? [`page scrolls sideways: ${document.documentElement.scrollWidth}px of ${width}px`]
        : []
    return [...page, ...elements]
  })

const shot = async (page, testInfo, name) => {
  await page.waitForTimeout(500)
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name.replaceAll(/\W+/g, '-')}-${name}.png`),
    fullPage: true,
  })
}

test('the main journey works and fits the screen', async ({ page, request }, testInfo) => {
  const problems = []
  page.on(
    'console',
    (message) => message.type() === 'error' && isNoise(message.text()) === false && problems.push(message.text()),
  )
  page.on('pageerror', (error) => problems.push(error.message))

  // The helpers walk the desktop layout, so the account and the domain are made at its width
  const device = page.viewportSize()
  await page.setViewportSize({ width: 1280, height: 800 })
  await createAccount(page, request, 'devices')
  const domain = await createDomain(page, 'shop.test')
  await page.setViewportSize(device)
  await sendView(request, domain, '/cart', { referrer: 'https://news.example', visitor: 0 })
  await sendView(request, domain, '/', { referrer: 'https://search.example/', visitor: 1 })
  await sendView(request, domain, '/menu', { visitor: 2 })
  await page.reload()

  // Overview
  await expect(page.locator('main')).toContainText(/views/i)
  await shot(page, testInfo, 'overview')
  const sizes = { overview: await overflowing(page) }

  // A report and a filter by a tap on its row
  await go(page, 'Traffic')
  await page.getByRole('tab', { name: 'Referrers' }).click()
  await expect(page.locator('main')).toContainText('search.example')
  await shot(page, testInfo, 'referrers')
  sizes.referrers = await overflowing(page)
  // A short title fits next to CSV and JSON, even on the narrowest phone (BUG-73)
  const title = page.locator('.card__inner--export .headline__button').first()
  expect
    .soft(
      await title.evaluate((element) => element.scrollWidth <= element.clientWidth),
      'the title of the card is not cut',
    )
    .toBe(true)
  await page.getByRole('button', { name: /news\.example/ }).click()
  await expect(page.getByRole('region', { name: 'Filters' })).toContainText('news.example')
  await expect(page.locator('main')).not.toContainText('search.example')
  sizes.filtered = await overflowing(page)

  // Settings
  await go(page, 'Settings')
  await expect(page.locator('main')).toContainText(/domains/i)
  await shot(page, testInfo, 'settings')
  sizes.settings = await overflowing(page)

  // Dark theme of the system
  await page.emulateMedia({ colorScheme: 'dark' })
  await go(page, 'Overview')
  await shot(page, testInfo, 'overview-dark')

  testInfo.annotations.push(
    { type: 'overflow', description: JSON.stringify(sizes) },
    { type: 'console', description: JSON.stringify(problems) },
  )
  expect.soft(Object.values(sizes).flat(), 'nothing reaches past the right edge').toEqual([])
  expect.soft(problems, 'no errors in the console').toEqual([])
})
