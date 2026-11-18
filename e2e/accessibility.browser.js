import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { createAccount, createDomain, graphql, sendView } from './_helpers.js'

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

// Known violations that stay, by rule id, each with a one-line reason. None for now.
const EXCEPTIONS = {}

const open = async (page, route) => {
  await page.goto(`/#/${route}`)
  await expect(page.locator('main')).not.toContainText('Loading')
}

// The serious and critical violations of WCAG 2.1 A and AA in the page or in a part of it
const violations = async (page, include) => {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (include != null) builder.include(include)

  const { violations } = await builder.analyze()

  return violations
    .filter((violation) => ['serious', 'critical'].includes(violation.impact))
    .filter((violation) => EXCEPTIONS[violation.id] == null)
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id} (${violation.impact}) ${node.target}`))
}

// A dialog, once it has faded in: a half-transparent text has no real contrast
const dialog = async (page, name) => {
  await expect(page.locator('.modal.visible').last()).toHaveCSS('opacity', '1')
  expect.soft(await violations(page, '.modal'), name).toEqual([])
}

// The axis lies over the bars, so the click is sent to the bar itself
const bar = (page) => page.locator('.barChart').first().locator('.barChart__column').last().dispatchEvent('click')

const close = (page) => page.getByRole('button', { name: 'Close' }).last().click()

test('the sign-in, the registration and the password reset pass axe', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  expect.soft(await violations(page), 'sign-in').toEqual([])

  await page.getByText('Create account', { exact: true }).click()
  await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
  expect.soft(await violations(page), 'registration').toEqual([])

  await page.getByText('← Back to sign in').click()
  await page.getByText('Forgot password', { exact: true }).click()
  await expect(page.getByRole('button', { name: /send link/i })).toBeVisible()
  expect.soft(await violations(page), 'password reset').toEqual([])
})

test('every report page and the settings pass axe', async ({ page, request }) => {
  await createAccount(page, request, 'axe-pages')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/', { referrer: 'https://news.example/' })
  await sendView(request, domain, '/cart', { visitor: 1 })
  await page.reload()

  for (const route of [...ROUTES, `domains/${domain.id}`]) {
    await open(page, route)
    expect.soft(await violations(page), `/#/${route}`).toEqual([])
  }
})

test('the dialogs pass axe', async ({ page, request }) => {
  await createAccount(page, request, 'axe-dialogs')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/')
  await graphql(page, 'mutation($input: CreateEventInput!) { createEvent(input: $input) { success } }', {
    input: { title: 'Order value', type: 'TOTAL_CHART' },
  })
  await graphql(
    page,
    'mutation($input: CreatePermanentTokenInput!) { createPermanentToken(input: $input) { success } }',
    { input: { title: 'Test key' } },
  )
  await page.reload()

  // A bar of the views and of the durations opens the details of its day
  await open(page, 'insights/views')
  await bar(page)
  await dialog(page, 'the views of a day')
  await close(page)

  await open(page, 'insights/durations')
  await bar(page)
  await dialog(page, 'the durations of a day')
  await close(page)

  await open(page, 'settings')
  await page.getByRole('button', { name: 'New domain' }).click()
  await dialog(page, 'a new domain')
  await close(page)

  await page.getByRole('button', { name: /shop\.test/ }).click()
  await dialog(page, 'a domain')
  await page.getByRole('button', { name: /Tracking rules/ }).click()
  await dialog(page, 'the tracking rules')
  await close(page)
  await page.getByRole('button', { name: /Google Analytics/ }).click()
  await dialog(page, 'Google Analytics')
  await close(page)
  await close(page)

  await page.getByRole('button', { name: 'New event' }).click()
  await dialog(page, 'a new event')
  await close(page)

  await page.getByRole('button', { name: /Order value/ }).click()
  await dialog(page, 'an event')
  await close(page)

  await page.getByRole('button', { name: 'New permanent token' }).click()
  await dialog(page, 'a new permanent token')
  await close(page)

  await page.getByRole('button', { name: /Test key/ }).click()
  await dialog(page, 'a permanent token')
  await close(page)

  await page.getByRole('button', { name: 'Invite member' }).click()
  await dialog(page, 'an invitation')
})
