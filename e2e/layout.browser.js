import { expect, test } from '@playwright/test'

import { createAccount, createDomain } from './_helpers.js'

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

// Waits for the page of a route to have its data, whatever the page is
const open = async (page, route) => {
  await page.goto(`/#/${route}`)
  await expect(page.locator('main')).not.toContainText('Loading')
}

// The elements that reach past the right edge of the screen, except the ones that sit in
// something that scrolls sideways, like the bar of the header. The width of the document says
// nothing: the page hides what does not fit.
const reachingOut = (page) =>
  page.evaluate(() => {
    const scrolls = (element) => {
      for (let node = element.parentElement; node != null; node = node.parentElement) {
        const { overflowX } = getComputedStyle(node)
        if (overflowX === 'auto' || overflowX === 'scroll') return true
      }

      return false
    }

    return [...document.querySelectorAll('body *')]
      .filter(
        (element) =>
          element.getClientRects().length > 0 &&
          element.getBoundingClientRect().right > window.innerWidth + 1 &&
          scrolls(element) === false,
      )
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className.baseVal ?? element.className)}`)
  })

test('every page opens without an error in the console', async ({ page, request }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

  await createAccount(page, request, 'layout')
  await createDomain(page, 'shop.test')

  for (const route of ROUTES) await open(page, route)

  expect(errors).toEqual([])
})

test('the pages and the dialogs fit the width of a phone', async ({ page, request }) => {
  await createAccount(page, request, 'layout-phone')
  await createDomain(page, 'a-domain-with-a-name-that-is-longer-than-a-phone-is-wide.example.com')
  await page.setViewportSize({ width: 390, height: 844 })

  for (const route of ROUTES) {
    await open(page, route)
    expect(await reachingOut(page), `/#/${route} reaches past the screen`).toEqual([])
  }

  // The dialogs of the settings are the widest things in it
  await page.reload()
  await page.getByRole('button', { name: 'New domain' }).click()
  expect(await reachingOut(page), 'the dialog of a new domain').toEqual([])
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Invite member' }).click()
  expect(await reachingOut(page), 'the dialog of an invitation').toEqual([])
  await expect(page.getByRole('button', { name: 'Send invitation' })).toBeInViewport()
})

// The lines of the text of an element: the box of a button is as high as its footer, so they are counted
const lines = (locator) =>
  locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)

    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  })

test('the sign-in card keeps its buttons readable on a phone and on a desktop', async ({ page }) => {
  for (const width of [1280, 480, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    // The font of the page is wider than the one before it, and the card is measured with it
    await page.evaluate(() => document.fonts.ready)

    // The main button is never squeezed into more than one line
    expect(await lines(page.getByRole('button', { name: /sign in →/i })), `Sign In at ${width} px`).toBe(1)

    // The links keep their words together on a phone
    if (width <= 480) {
      for (const name of ['Create account', 'Forgot password']) {
        expect(await lines(page.getByText(name, { exact: true })), `${name} at ${width} px`).toBe(1)
      }
    }

    expect(await reachingOut(page), `the sign-in card at ${width} px`).toEqual([])
  }
})
