import { expect, test } from '@playwright/test'

const MAILPIT = process.env.E2E_MAILPIT ?? 'http://localhost:8025'
const ACKEE = process.env.E2E_URL ?? 'http://localhost:3000'
const PASSWORD = 'a-password-for-e2e'

// The tracker ignores headless browsers as bots, so the visitor looks like a regular Chrome
const VISITOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

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

const newAddress = () => `e2e-tracking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

const confirmationLink = async (request, address) => {
  let link
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(address)}`)
        const [message] = (await search.json()).messages ?? []
        if (message == null) return
        const body = await (await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)).json()
        link = body.Text.match(/https?:\/\/\S+\/verify\?token=[\w-]+/)?.[0]
        return link
      },
      { timeout: 15_000 },
    )
    .toBeTruthy()
  return link
}

// GraphQL from the signed-in Ackee page, with its own session
const graphql = (page, query, variables) =>
  page.evaluate(
    async ({ query, variables }) => {
      const key = Object.keys(localStorage).find((name) => name.startsWith('ackee_token_'))
      const token = JSON.parse(localStorage.getItem(key))
      const response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      })
      return response.json()
    },
    { query, variables },
  )

// A small shop at http://shop.test, served by the test itself, with the one Ackee snippet
const shop = (snippet) => (path) => `<!doctype html><html><head>${snippet}</head><body style="margin:0">
  <h1>${path}</h1>
  <button id="buy">Buy</button>
  <a id="away" href="http://elsewhere.test/page" target="_blank">Elsewhere</a>
  <a id="file" href="/files/price-list.pdf" target="_blank">Price list</a>
  <form id="signup" onsubmit="event.preventDefault()"><input name="email" value="secret@example.com"><button>Join</button></form>
  <div style="height:2500px"></div>
  <div class="banner" style="height:300px">Banner</div>
</body></html>`

test('rules set up in Ackee collect clicks, views, forms, links, downloads and scrolling on the site', async ({
  page,
  request,
  browser,
}) => {
  const address = newAddress()

  await page.goto('/')
  await page.getByText('Create account', { exact: true }).click()
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByPlaceholder(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()
  await page.goto(await confirmationLink(request, address))
  await page.goto('/')
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByPlaceholder(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()

  const created = await graphql(
    page,
    'mutation { createDomain(input: { title: "shop.test" }) { payload { id ingestKey } } }',
  )
  const { id, ingestKey } = created.data.createDomain.payload

  const saved = await graphql(
    page,
    `
      mutation save($id: ID!, $input: DomainTrackingInput!) {
        updateDomainTracking(id: $id, input: $input) {
          payload {
            events {
              clicks
              seen
              forms
              outbound
              downloads
              scroll
            }
          }
        }
      }
    `,
    {
      id,
      input: {
        outbound: true,
        downloads: true,
        scroll: true,
        rules: [
          { type: 'CLICK', selector: '#buy', label: 'Buy button' },
          { type: 'VISIBLE', selector: '.banner', label: 'Banner', path: '/product/*' },
          { type: 'FORM', selector: '#signup', label: 'Newsletter' },
        ],
      },
    },
  )
  const events = saved.data.updateDomainTracking.payload.events

  // The visitor: another browser profile, so Ackee's own sign-in does not mark the visits as the owner's
  const visitor = await browser.newContext({ userAgent: VISITOR })
  const site = await visitor.newPage()
  const html = shop(`<script async src="${ACKEE}/t/${id}.${ingestKey}.js"></script>`)
  await visitor.route('http://shop.test/**', (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.endsWith('.pdf')) return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4' })
    return route.fulfill({ contentType: 'text/html', body: html(pathname) })
  })
  await visitor.route('http://elsewhere.test/**', (route) => route.fulfill({ contentType: 'text/html', body: 'away' }))

  // The home page: the banner rule is for product pages only, so seeing it here counts nothing
  await site.goto('http://shop.test/')
  await site.waitForFunction(() => globalThis.ackeeTracker != null)
  await site.locator('#buy').click()
  await site.locator('#buy').click()
  await site.locator('#signup button').click()
  await site.mouse.wheel(0, 5000)
  await site.waitForTimeout(1500)
  await site.locator('#file').click()

  // A product page: the banner rule applies here
  await site.goto('http://shop.test/product/runner-x/')
  await site.waitForFunction(() => globalThis.ackeeTracker != null)
  await site.locator('.banner').scrollIntoViewIfNeeded()
  await site.waitForTimeout(1500)
  await site.locator('#away').click()
  await site.waitForTimeout(1000)
  await visitor.close()

  const list = async (eventId) => {
    const { data } = await graphql(
      page,
      `
        query list($id: ID!) {
          event(id: $id) {
            statistics {
              list(sorting: TOP, type: TOTAL, range: LAST_24_HOURS, limit: 20) {
                value
                count
              }
            }
          }
        }
      `,
      { id: eventId },
    )
    return Object.fromEntries(data.event.statistics.list.map((entry) => [entry.value, entry.count]))
  }

  await expect.poll(() => list(events.clicks), { timeout: 15_000 }).toEqual({ 'Buy button': 2 })
  await expect.poll(() => list(events.seen)).toEqual({ Banner: 1 })
  await expect.poll(() => list(events.forms)).toEqual({ Newsletter: 1 })
  await expect.poll(() => list(events.outbound)).toEqual({ 'elsewhere.test': 1 })
  await expect.poll(() => list(events.downloads)).toEqual({ 'price-list.pdf': 1 })
  await expect
    .poll(async () => Object.keys(await list(events.scroll)).toSorted())
    .toEqual(['100%', '25%', '50%', '75%'])

  // What someone typed never leaves the page
  const everything = JSON.stringify(await Promise.all(Object.values(events).map((eventId) => list(eventId))))
  expect(everything).not.toContain('secret@example.com')
})

// Review of #36: without ACKEE_URL the snippet reads its own address from document.currentScript,
// and a page where visitors can place HTML can put an <img name="currentScript"> in its place
test('a page that forges document.currentScript gets no tracking instead of tracking to a stranger', async ({
  page,
  request,
  browser,
}) => {
  const address = newAddress()

  await page.goto('/')
  await page.getByText('Create account', { exact: true }).click()
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByPlaceholder(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()
  await page.goto(await confirmationLink(request, address))
  await page.goto('/')
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByPlaceholder(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()

  const created = await graphql(
    page,
    'mutation { createDomain(input: { title: "shop.test" }) { payload { id ingestKey } } }',
  )
  const { id, ingestKey } = created.data.createDomain.payload

  const visitor = await browser.newContext({ userAgent: VISITOR })
  const site = await visitor.newPage()
  const snippet = `<script async src="${ACKEE}/t/${id}.${ingestKey}.js"></script>`
  const forged = `<img name="currentScript" src="http://evil.test/pixel.gif">`
  // The stands set ACKEE_URL; this is a server without it, where the snippet carries no address
  await visitor.route(`${ACKEE}/t/**`, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(/"server":"[^"]*"/, '"server":""')
    await route.fulfill({ response, body })
  })
  const requests = []
  await visitor.route(/^http:\/\/(shop|evil)\.test\//, (route) => {
    const { method, url } = { method: route.request().method(), url: route.request().url() }
    requests.push(`${method} ${new URL(url).origin}`)
    if (url.startsWith('http://evil.test/')) return route.fulfill({ status: 204 })
    return route.fulfill({
      contentType: 'text/html',
      body: shop(url.includes('forged') ? forged + snippet : snippet)('/'),
    })
  })
  await site.route(`${ACKEE}/api`, (route) => {
    requests.push(`${route.request().method()} ${ACKEE}`)
    return route.continue()
  })

  // A plain page: the snippet reports to the server it came from
  await site.goto('http://shop.test/')
  await site.waitForFunction(() => globalThis.ackeeTracker != null)
  await expect.poll(() => requests.filter((entry) => entry === `POST ${ACKEE}`).length).toBeGreaterThan(0)

  // The forged page: nothing goes to the stranger, and nothing is recorded either
  requests.length = 0
  await site.goto('http://shop.test/forged')
  await site.waitForFunction(() => globalThis.ackeeTracker != null)
  await site.waitForTimeout(1500)
  expect(requests.filter((entry) => entry.startsWith('POST '))).toEqual([])
  expect(requests).not.toContain('POST http://evil.test')
  await visitor.close()
})
