import { expect, test } from '@playwright/test'

import { VISITOR, createAccount, createDomain, graphql } from './_helpers.js'

const ACKEE = process.env.E2E_URL ?? 'http://localhost:3000'

// The fake site counts as public and Ackee in the compose network as local, so Chromium's local
// network checks would block the snippet. On a real site Ackee has a public address. The host
// rules from playwright.config.js stay, or the browser would not find Ackee by name.
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

// The snippet of the domain as Settings shows it: the id and the key in one attribute
const snippet = (domain, key = domain.ingestKey) =>
  `<script async src="${ACKEE}/tracker.js" data-ackee-server="${ACKEE}" data-ackee-domain-id="${domain.id}.${key}"></script>`

// A site at http://shop.test that is served by the test itself
const site = async (context, domain, key) => {
  await context.route('http://shop.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${snippet(domain, key)}</head><body><h1>${new URL(route.request().url()).pathname}</h1></body></html>`,
    }),
  )
}

const viewsToday = async (page, domain) =>
  (await graphql(page, 'query($id: ID!) { domain(id: $id) { facts { viewsToday } } }', { id: domain.id })).data.domain
    .facts.viewsToday

test('the tracker of a site records the view of a visitor, and the owner sees the page', async ({
  browser,
  page,
  request,
}) => {
  await createAccount(page, request, 'tracker')
  const domain = await createDomain(page, 'shop.test')

  // The visitor: another browser profile, so Ackee's own sign-in does not mark the visit as the owner's
  const visitor = await browser.newContext({ userAgent: VISITOR })
  await site(visitor, domain)
  const shop = await visitor.newPage()
  await shop.goto('http://shop.test/cart')

  await expect.poll(() => viewsToday(page, domain)).toBe(1)

  await page.goto('/')
  await expect(page.getByText('http://shop.test/cart')).toBeVisible()

  await visitor.close()
})

test('a visit of the signed-in owner is ignored, as the tracker says', async ({ browser, page, request }) => {
  await createAccount(page, request, 'tracker-owner')
  const domain = await createDomain(page, 'shop.test')

  // The owner opens the site in the browser that is signed in to Ackee
  await site(page.context(), domain)
  const own = await page.context().newPage()
  const said = new Promise((resolve) =>
    own.on('console', (message) => /ignores you/.test(message.text()) && resolve(true)),
  )
  await own.goto('http://shop.test/owner')
  expect(await said).toBe(true)

  // A visitor comes after, and only that view is counted
  const visitor = await browser.newContext({ userAgent: VISITOR })
  await site(visitor, domain)
  await (await visitor.newPage()).goto('http://shop.test/visitor')

  await expect.poll(() => viewsToday(page, domain)).toBe(1)
  await page.goto('/')
  await expect(page.getByText('http://shop.test/visitor')).toBeVisible()
  await expect(page.getByText('http://shop.test/owner')).toHaveCount(0)

  await visitor.close()
})

test('a snippet with a wrong key is refused, and the view is not stored', async ({ browser, page, request }) => {
  await createAccount(page, request, 'tracker-key')
  const domain = await createDomain(page, 'shop.test')

  const visitor = await browser.newContext({ userAgent: VISITOR })
  await site(visitor, domain, 'a-key-that-is-not-ours')
  const shop = await visitor.newPage()
  const answer = shop.waitForResponse(
    (response) => response.url().endsWith('/api') && response.request().method() === 'POST',
  )
  await shop.goto('http://shop.test/')

  const { errors } = await (await answer).json()
  expect(errors[0].message).toBe('Ingest key missing or wrong')
  expect(await viewsToday(page, domain)).toBe(0)

  await visitor.close()
})
