import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

test('a view appears in the live feed while it is open', async ({ page, request }) => {
  await createAccount(page, request, 'live')
  const domain = await createDomain(page, 'shop.test')

  await page.getByRole('button', { name: 'Insights' }).click()
  await page.getByRole('button', { name: 'Live' }).click()

  await sendView(request, domain, '/just-now')
  await expect(page.getByText('/just-now')).toBeVisible({ timeout: 15_000 })
})
