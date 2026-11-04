import { expect, test } from '@playwright/test'

import { createAccount, createDomain, sendView } from './_helpers.js'

// The name of a row of a list is its count and its address
const START = /http:\/\/shop\.test\/$/

const navigation = (page) => page.getByRole('navigation', { name: 'Main' })
const filters = (page) => page.getByRole('region', { name: 'Filters' })

// Two pages: the cart is reached from the news, the start page from a search engine
const seed = async (page, request, name) => {
  await createAccount(page, request, name)
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/cart', { referrer: 'https://news.example', visitor: 0 })
  await sendView(request, domain, '/cart', { referrer: 'https://news.example', visitor: 1 })
  await sendView(request, domain, '/', { referrer: 'https://search.example/', visitor: 2 })
  // The reports list the domains read when the page loads
  await page.reload()
  return domain
}

test('a click on a referrer filters every report, and the filter stays on other pages', async ({ page, request }) => {
  await seed(page, request, 'filters')

  await navigation(page).getByRole('link', { name: 'Traffic' }).click()
  await page.getByRole('tab', { name: 'Referrers' }).click()
  await expect(page.locator('main')).toContainText('search.example')

  await page.getByRole('button', { name: /news\.example/ }).click()
  // The referrer as Ackee keeps it
  await expect(page).toHaveURL(/\?filter=SITE_REFERRER%3Ahttps%3A%2F%2Fnews\.example$/)
  await expect(filters(page)).toContainText('Referrer')
  await expect(filters(page)).toContainText('https://news.example')
  await expect(page.locator('main')).not.toContainText('search.example')

  // Where people from the news went: the cart only
  await page.getByRole('tab', { name: 'Pages' }).click()
  await expect(page.locator('main')).toContainText('http://shop.test/cart')
  await expect(page.getByRole('button', { name: START })).toHaveCount(0)

  // The navigation keeps it as well
  await navigation(page).getByRole('link', { name: 'Overview' }).click()
  await expect(page).toHaveURL(/#\/\?filter=SITE_REFERRER/)
  await expect(filters(page)).toContainText('https://news.example')

  // A second click narrows further, Back undoes it, × removes the rest
  await navigation(page).getByRole('link', { name: 'Traffic' }).click()
  await page.getByRole('tab', { name: 'Pages' }).click()
  await page.getByRole('button', { name: 'http://shop.test/cart' }).click()
  await expect(filters(page)).toContainText('Page')
  await page.goBack()
  await expect(filters(page)).not.toContainText('Page')
  await filters(page)
    .getByRole('button', { name: /Remove the filter Referrer/ })
    .click()
  await expect(page.getByRole('button', { name: START })).toBeVisible()
})

test('a link with a filter opens the filtered reports', async ({ page, request }) => {
  await seed(page, request, 'filters-link')

  await page.goto(`/#/insights/pages?filter=${encodeURIComponent('SITE_REFERRER:https://search.example')}`)
  await expect(filters(page)).toContainText('https://search.example')
  await expect(page.getByRole('button', { name: START })).toBeVisible()
  await expect(page.getByRole('button', { name: 'http://shop.test/cart' })).toHaveCount(0)
})

test('a period from to replaces the range of the lists', async ({ page, request }) => {
  await seed(page, request, 'filters-period')
  await navigation(page).getByRole('link', { name: 'Traffic' }).click()
  await page.getByRole('tab', { name: 'Pages' }).click()
  await expect(page.getByRole('button', { name: 'http://shop.test/cart' })).toBeVisible()

  const day = (offset) => {
    const date = new Date(Date.now() + offset * 86_400_000)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  // Last week without today: the views of today are not in it
  await filters(page).getByLabel('From').fill(day(-7))
  await filters(page).getByLabel('To').fill(day(-1))
  await expect(page).toHaveURL(new RegExp(`from=${day(-7)}&to=${day(-1)}`))
  await expect(page.getByRole('button', { name: 'http://shop.test/cart' })).toHaveCount(0)

  await filters(page).getByLabel('To').fill(day(0))
  await expect(page.getByRole('button', { name: 'http://shop.test/cart' })).toBeVisible()

  await filters(page).getByRole('button', { name: 'Clear' }).click()
  await expect(page).not.toHaveURL(/from=/)
})
