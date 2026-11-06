import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

const violations = (page) => {
  const found = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) found.push(message.text())
  })
  return found
}

test('the interface works under the policy and an injected script does not run', async ({ page, request }) => {
  const found = violations(page)

  await createAccount(page, request, 'csp')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/')

  for (const path of [
    '/',
    `/domains/${domain.id}`,
    '/insights/views',
    '/insights/events',
    '/insights/systems',
    '/settings',
  ]) {
    await page.goto(`/#${path}`)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  }

  expect(found).toEqual([])

  const ran = await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'globalThis.injected = true'
    document.head.append(script)
    return globalThis.injected === true
  })

  expect(ran).toBe(false)
  expect(found).toHaveLength(1)
})
