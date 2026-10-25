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
