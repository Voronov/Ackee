import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

const viewsToday = (page) => page.getByRole('heading', { name: 'Views today' }).locator('..')

test('the overview shows all domains together or one domain at a time', async ({ page, request }) => {
  await createAccount(page, request, 'select')
  const first = await createDomain(page, 'first.test')
  const second = await createDomain(page, 'second.test')

  // Two visitors on the first domain, one on the second
  await sendView(request, first, '/one', { visitor: 0 })
  await sendView(request, first, '/one', { visitor: 1 })
  await sendView(request, second, '/two', { visitor: 2 })

  await page.goto('/')
  await expect(viewsToday(page)).toContainText('3')
  await expect(page.getByText('http://first.test/one')).toBeVisible()
  await expect(page.getByText('http://second.test/two')).toBeVisible()

  const select = page.getByRole('combobox').first()
  await select.selectOption({ label: 'first.test' })
  await expect(viewsToday(page)).toContainText('2')
  await expect(page.getByText('http://second.test/two')).toHaveCount(0)

  await select.selectOption({ label: 'second.test' })
  await expect(viewsToday(page)).toContainText('1')
  await expect(page.getByText('http://first.test/one')).toHaveCount(0)

  await select.selectOption({ label: 'All domains' })
  await expect(viewsToday(page)).toContainText('3')
})
