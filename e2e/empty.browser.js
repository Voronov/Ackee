import { expect, test } from '@playwright/test'

import { createAccount, createDomain } from './_helpers.js'

test('a new account is told what to do first, and the hint goes with the first domain', async ({ page, request }) => {
  await createAccount(page, request, 'empty-overview')

  const hint = page.getByText(/no domain yet/i)
  await expect(hint).toBeVisible()
  await expect(page.getByText(/add one under settings/i)).toBeVisible()

  await createDomain(page, 'shop.test')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Views today' })).toBeVisible()
  await expect(hint).toHaveCount(0)
})

test('the events page says so when there is no event, and shows the events when there are', async ({
  page,
  request,
}) => {
  await createAccount(page, request, 'empty-events')

  await page.goto('/#/insights/events')
  await expect(page.getByText(/no event yet/i)).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'New event' }).click()
  await page.getByPlaceholder('Event title').fill('Order value')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: /Order value/ })).toBeVisible()

  await page.goto('/#/insights/events')
  await expect(page.getByText('Order value')).toBeVisible()
  await expect(page.getByText(/no event yet/i)).toHaveCount(0)
})

test('the two links in the dialog of a domain are on lines of their own', async ({ page, request }) => {
  await createAccount(page, request, 'empty-links')
  await createDomain(page, 'shop.test')
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /shop\.test/ }).click()

  const rules = await page.getByRole('button', { name: /Tracking rules/ }).boundingBox()
  const google = await page.getByRole('button', { name: /Google Analytics/ }).boundingBox()

  expect(google.y).toBeGreaterThan(rules.y + rules.height - 1)
})
