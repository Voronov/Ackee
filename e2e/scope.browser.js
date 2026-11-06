import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

const LONG_PATH = `/${'a'.repeat(2100)}`

const filters = (page) => page.getByRole('region', { name: 'Filters' })
const oops = (page) => page.getByRole('heading', { name: 'Oops' })
const modal = (page) => page.locator('.modal')
// The axis lies over the bars, so a real click at their middle would land on it
const clickBar = (page, index) =>
  page.locator('.barChart').first().locator('.barChart__column').nth(index).dispatchEvent('click')

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const MONTH = `from=${day(-30)}&to=${day(0)}`

const seed = async (page, request, name) => {
  await createAccount(page, request, name)
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/', { visitor: 0 })
  await sendView(request, domain, '/cart', { visitor: 1 })
  // The reports list the domains read when the page loads
  await page.reload()
  return domain
}

// A crash of the page or a refused query both end on Oops, and both must survive a reload
const opensWithoutOops = async (page, address) => {
  await page.goto(address)
  await page.reload()
  await expect(page.locator('main')).toContainText('shop.test')
  await expect(oops(page)).toHaveCount(0)
}

const saveSource = async (page, source) => {
  await page.evaluate((value) => localStorage.setItem('ackee_source', JSON.stringify(value)), source)
}

for (const [report, headline] of [
  ['views', 'Site Views'],
  ['durations', 'Durations'],
]) {
  test(`the ${report} dialog of a bar past the 14th reads the period under a saved Google source`, async ({
    page,
    request,
  }) => {
    await seed(page, request, `scope-${report}-ga4`)
    await saveSource(page, 'GA4')
    await page.goto(`/#/insights/${report}?${MONTH}`)
    await page.reload()

    await clickBar(page, 20)
    await expect(modal(page).getByRole('heading', { name: headline })).toBeVisible()
    await expect(modal(page)).toContainText(day(-20))
    await expect(oops(page)).toHaveCount(0)
  })

  test(`the ${report} dialog stays on the bar after Back`, async ({ page, request }) => {
    await seed(page, request, `scope-${report}-back`)
    await page.goto(`/#/insights/${report}`)
    await filters(page).getByLabel('From').fill(day(-30))
    await filters(page).getByLabel('To').fill(day(0))
    await expect(page).toHaveURL(new RegExp(MONTH))

    await clickBar(page, 20)
    await expect(modal(page)).toContainText(day(-20))

    await page.goBack()
    await page.goBack()
    await expect(page).not.toHaveURL(/from=/)
    await expect(modal(page)).toContainText(day(-20))
    await expect(oops(page)).toHaveCount(0)
  })
}

test('the dialog of a recent bar shows the views of Ackee under a saved Google source', async ({ page, request }) => {
  await seed(page, request, 'scope-ga4-recent')
  await saveSource(page, 'GA4')
  await page.goto(`/#/insights/views?${MONTH}`)
  await page.reload()

  await clickBar(page, 0)
  await expect(modal(page)).toContainText(day(0))
  await expect(modal(page)).toContainText('shop.test')
  await expect(modal(page)).not.toContainText('Today')
  await expect(modal(page).locator('.flexList')).toContainText('2')
})

for (const search of [
  'from=2026-02-01&to=2026-02-31',
  'from=2026-04-01&to=2026-04-31',
  'from=0000-01-01&to=0000-01-31',
  'filter=FOO:bar',
  'filter=',
  `filter=SITE_LOCATION:${'a'.repeat(2001)}`,
  Array.from({ length: 11 }, (_, index) => `filter=COUNTRY:A${index}`).join('&'),
]) {
  test(`a link the server would refuse opens the reports: ${search.slice(0, 40)}`, async ({ page, request }) => {
    await seed(page, request, 'scope-refused')
    await opensWithoutOops(page, `/#/insights/views?${search}`)
  })
}

test('a page too long to filter by is no filter button, but still opens', async ({ page, request }) => {
  await createAccount(page, request, 'scope-long')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, LONG_PATH, { visitor: 0 })
  await sendView(request, domain, '/cart', { visitor: 1 })
  await page.reload()

  await page.goto('/#/insights/pages')
  await expect(page.getByRole('button', { name: 'http://shop.test/cart' })).toBeVisible()
  await expect(page.getByRole('link', { name: /shop\.test\/aaa/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /shop\.test\/aaa/ })).toHaveCount(0)
})

for (const filter of ['COUNTRY:nope', 'COUNTRY:', '__proto__:x', 'constructor:x']) {
  test(`a crafted filter does not crash the page: ${filter}`, async ({ page, request }) => {
    await seed(page, request, 'scope-crafted')
    await opensWithoutOops(page, `/#/insights/views?filter=${filter}`)
    await expect(filters(page)).toBeVisible()
  })
}

test('a country filter that is no country shows as it was written', async ({ page, request }) => {
  await seed(page, request, 'scope-country')
  await opensWithoutOops(page, '/#/insights/views?filter=COUNTRY:nope')
  await expect(filters(page)).toContainText('nope')
})

test('date fields that differ from the applied period say so', async ({ page, request }) => {
  await seed(page, request, 'scope-fields')
  const from = filters(page).getByLabel('From')
  const note = filters(page).getByRole('status')

  await page.goto(`/#/insights/views?${MONTH}`)
  await expect(from).toHaveValue(day(-30))
  await expect(note).toHaveCount(0)

  await from.fill('')
  await expect(note).toContainText('both days')
  await expect(note).toContainText(`${day(-30)} to ${day(0)}`)
  await expect(page).toHaveURL(new RegExp(MONTH))

  await from.fill('2000-01-01')
  await expect(note).toContainText('at most 3660 days')
  await expect(page).toHaveURL(new RegExp(MONTH))

  await from.fill(day(-7))
  await expect(page).toHaveURL(new RegExp(`from=${day(-7)}`))
  await expect(note).toHaveCount(0)
})

test('a failed report keeps the session, and the way out clears the scope', async ({ page, request }) => {
  await seed(page, request, 'scope-failed-report')
  await page.route('**/api', (route) =>
    route.request().postData()?.includes('fetchMergedViews')
      ? route.fulfill({ json: { errors: [{ message: 'A report failed' }] } })
      : route.continue(),
  )
  await page.goto('/#/insights/views?filter=COUNTRY:UA')
  await page.reload()
  await expect(oops(page)).toBeVisible()

  await page.unrouteAll()
  await page.getByRole('button', { name: 'Reload Ackee' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(oops(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/filter=/)
})

test('an invalid token still ends on the login', async ({ page, request }) => {
  await seed(page, request, 'scope-invalid-token')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('ackee_token_'))
    localStorage.setItem(key, JSON.stringify('no-such-token'))
  })
  await page.reload()
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
})

test('a refused value leaves the address without a history entry', async ({ page, request }) => {
  await seed(page, request, 'scope-address')
  await page.goto('/#/insights/views')
  await expect(page.locator('main')).toContainText('shop.test')

  await page.goto('/#/insights/views?filter=FOO:bar&filter=COUNTRY:UA&from=2026-02-01&to=2026-02-31')
  await expect(page).toHaveURL(/#\/insights\/views\?filter=COUNTRY%3AUA$/)

  await page.goBack()
  await expect(page).toHaveURL(/#\/insights\/views$/)
})

test('date fields go back to the applied period when they lose the focus', async ({ page, request }) => {
  await seed(page, request, 'scope-blur')
  const from = filters(page).getByLabel('From')
  const note = filters(page).getByRole('status')

  await page.goto(`/#/insights/views?${MONTH}`)
  await expect(from).toHaveValue(day(-30))

  await from.fill('')
  await from.blur()
  await expect(from).toHaveValue(day(-30))
  await expect(note).toContainText('both days')

  await from.fill('2000-01-01')
  await from.blur()
  await expect(from).toHaveValue(day(-30))
  await expect(note).toContainText('at most 3660 days')
  await expect(page).toHaveURL(new RegExp(MONTH))

  await from.fill(day(-7))
  await expect(page).toHaveURL(new RegExp(`from=${day(-7)}`))
  await expect(note).toHaveCount(0)
})

test('a period can be picked one day after the other', async ({ page, request }) => {
  await seed(page, request, 'scope-picked')
  const from = filters(page).getByLabel('From')
  const to = filters(page).getByLabel('To')

  await page.goto('/#/insights/views')
  await from.fill(day(-7))
  await to.focus()
  await expect(from).toHaveValue(day(-7))

  await to.fill(day(0))
  await expect(page).toHaveURL(new RegExp(`from=${day(-7)}&to=${day(0)}`))
})

test('the dialog of a selected domain lists that domain only', async ({ page, request }) => {
  const domain = await seed(page, request, 'scope-selected')
  await createDomain(page, 'other.test')
  await sendView(request, domain, '/', { visitor: 2 })
  await page.reload()

  await page.goto('/#/insights/views')
  await page.locator('#domain-select').selectOption({ label: 'shop.test' })
  await clickBar(page, 0)
  await expect(modal(page).locator('.flexList')).toContainText('shop.test')
  await expect(modal(page).locator('.flexList')).not.toContainText('other.test')
})
