import { expect, test } from '@playwright/test'

import { VISITOR, createAccount, createDomain, graphql } from './_helpers.js'

const ACKEE = process.env.E2E_URL ?? 'http://localhost:3000'

// The fake site counts as public and Ackee in the compose network as local, so Chromium's local
// network checks would block the snippet, see tracker.browser.js.
test.use({
  launchOptions: async ({ launchOptions }, use) => {
    await use({
      ...launchOptions,
      args: [
        ...(launchOptions.args ?? []),
        '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
      ],
    })
  },
})

const snippet = (domain) =>
  `<script async src="${ACKEE}/tracker.js" data-ackee-server="${ACKEE}" data-ackee-domain-id="${domain.id}.${domain.ingestKey}"></script>`

const viewsToday = async (page, id) =>
  (await graphql(page, 'query($id: ID!) { domain(id: $id) { facts { viewsToday } } }', { id })).data.domain.facts
    .viewsToday

const countries = async (page, id) =>
  (
    await graphql(
      page,
      'query($id: ID!) { domain(id: $id) { statistics { countries(sorting: TOP, range: LAST_24_HOURS) { value count } } } }',
      { id },
    )
  ).data.domain.statistics.countries

const collectsCountry = async (page, id) =>
  (await graphql(page, 'query($id: ID!) { domain(id: $id) { collectCountry } }', { id })).data.domain.collectCountry

// A visit from a public address, as a proxy in front of Ackee would pass it on. Another browser
// version is another visitor, so no visit removes the personal data of an earlier one.
const visit = async (browser, domain, address, version) => {
  const visitor = await browser.newContext({
    userAgent: VISITOR.replace('141.0.0.0', `${version}.0.0.0`),
    extraHTTPHeaders: { 'X-Forwarded-For': address },
  })
  await visitor.route('http://shop.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${snippet(domain)}</head><body><h1>Shop</h1></body></html>`,
    }),
  )
  const shop = await visitor.newPage()
  await shop.goto('http://shop.test/')

  return visitor
}

test('the country of a visitor is reported only after the owner turned it on in the domain dialog', async ({
  browser,
  page,
  request,
}) => {
  await createAccount(page, request, 'countries')
  const domain = await createDomain(page, 'shop.test')

  await test.step('off by default: a visit is counted, but no country is kept', async () => {
    const visitor = await visit(browser, domain, '8.8.8.8', 150)
    await expect.poll(() => viewsToday(page, domain.id)).toBe(1)
    expect(await countries(page, domain.id)).toEqual([])
    await visitor.close()
  })

  await test.step('the owner turns it on in the dialog of the domain, next to the warning', async () => {
    // The domain was made through the API, so the list of the owner needs a fresh load
    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: /shop\.test/ }).click()
    await expect(page.getByText(/personal data/i)).toBeVisible()
    await page.getByLabel(/read the country from the address/i).check()
    await expect.poll(() => collectsCountry(page, domain.id)).toBe(true)
  })

  await test.step('the next visit carries its country, and the report shows it', async () => {
    const visitor = await visit(browser, domain, '91.198.174.192', 151)
    await expect.poll(() => viewsToday(page, domain.id)).toBe(2)
    // The visit from before the switch stays without a country and is left out
    await expect.poll(() => countries(page, domain.id)).toEqual([{ value: 'Netherlands', count: 1 }])
    await visitor.close()

    await page.goto('/#/insights/countries')
    await expect(page.getByText('Netherlands')).toBeVisible()
  })
})
