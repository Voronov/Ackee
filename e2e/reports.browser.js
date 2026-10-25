import { expect, test } from '@playwright/test'

import { createAccount, createDomain, graphql, sendView } from './_helpers.js'

const viewsToday = async (page, domain) =>
  (await graphql(page, 'query($id: ID!) { domain(id: $id) { facts { viewsToday } } }', { id: domain.id })).data.domain
    .facts.viewsToday

test('views sent to a domain show in its reports', async ({ page, request }) => {
  await createAccount(page, request, 'reports')
  const domain = await createDomain(page, 'shop.test')

  // Three visitors, two of them look at the cart
  for (const [visitor, path] of ['/cart', '/cart', '/checkout'].entries()) {
    const answer = await sendView(request, domain, path, { referrer: 'https://news.example/', visitor })
    expect(answer.errors).toBeUndefined()
    expect(answer.data.createRecord.success).toBe(true)
  }

  await expect.poll(() => viewsToday(page, domain)).toBe(3)

  // The numbers of the day are on the overview, the pages and referrers have their own lists
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Views today' })).toBeVisible()
  await expect(page.getByText('http://shop.test/cart')).toBeVisible()
  await expect(page.getByText('http://shop.test/checkout')).toBeVisible()
  await expect(page.getByText('news.example')).toBeVisible()
})

test('a visit with a cookie of the owner is not counted', async ({ page, request }) => {
  await createAccount(page, request, 'reports-ignore')
  const domain = await createDomain(page, 'shop.test')

  await sendView(request, domain, '/counted')
  const ignored = await sendView(request, domain, '/ignored', { headers: { Cookie: 'ackee_ignore=1' } })

  // The tracker is answered as for a real visit, only nothing is stored
  expect(ignored.data.createRecord.success).toBe(true)
  await expect.poll(() => viewsToday(page, domain)).toBe(1)
})

test('a view of an unknown domain is refused', async ({ page, request }) => {
  await createAccount(page, request, 'reports-unknown')

  const answer = await sendView(request, { id: '00000000-0000-4000-8000-000000000000', title: 'nobody.test' }, '/')

  expect(answer.errors[0].message).toBe('Unknown domain')
})
