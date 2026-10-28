import { expect, test } from '@playwright/test'

import { VISITOR, createAccount, graphql } from './_helpers.js'

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

const viewsToday = async (page, id) =>
  (await graphql(page, 'query($id: ID!) { domain(id: $id) { facts { viewsToday } } }', { id })).data.domain.facts
    .viewsToday

// The way of a new user, as the definition of done of EP-B describes it: from the sign-up form to
// the first report, with the embed code copied from Settings, and nothing of it visible to anyone else.
test('a new user goes from registration to the first report, and another user sees none of it', async ({
  browser,
  page,
  request,
}) => {
  await test.step('register, confirm the address by the emailed link, sign in', async () => {
    await createAccount(page, request, 'journey')
    await expect(page.getByText(/no domain yet/i)).toBeVisible()
  })

  const { id, embedCode } = await test.step('add the domain under Settings and copy its embed code', async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'New domain' }).click()
    await page.getByPlaceholder('Domain title').fill('journey.test')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: /journey\.test/ }).click()

    return {
      id: await page.getByLabel('Domain id').inputValue(),
      embedCode: await page.getByLabel('Embed code', { exact: true }).inputValue(),
    }
  })

  // Another browser profile, so Ackee's own sign-in does not mark the visit as the owner's
  const visitor = await browser.newContext({ userAgent: VISITOR })

  await test.step('a visitor opens a page of the site that carries the embed code', async () => {
    // The site is served by the test itself, with the snippet exactly as the owner copied it
    await visitor.route('http://journey.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head>${embedCode}</head><body><h1>Pricing</h1></body></html>`,
      }),
    )
    await (await visitor.newPage()).goto('http://journey.test/pricing')
  })

  await test.step('the owner sees the visit in the report', async () => {
    await expect.poll(() => viewsToday(page, id)).toBe(1)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Views today' })).toBeVisible()
    await expect(page.getByText('http://journey.test/pricing')).toBeVisible()
  })

  await test.step('another new user sees nothing of it', async () => {
    const context = await browser.newContext({ baseURL: process.env.E2E_URL ?? 'http://localhost:3000' })
    const stranger = await context.newPage()
    await createAccount(stranger, request, 'journey-stranger')

    await expect(stranger.getByText(/no domain yet/i)).toBeVisible()
    await stranger.getByRole('button', { name: 'Settings' }).click()
    await expect(stranger.getByRole('button', { name: 'New domain' })).toBeVisible()
    await expect(stranger.getByRole('button', { name: /journey\.test/ })).toHaveCount(0)

    expect((await graphql(stranger, '{ domains { id } }')).data.domains).toEqual([])
    const read = await graphql(stranger, 'query($id: ID!) { domain(id: $id) { title } }', { id })
    expect(read.data?.domain ?? null).toBeNull()

    await context.close()
  })

  await visitor.close()
})
