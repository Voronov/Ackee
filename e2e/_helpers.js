import { expect } from '@playwright/test'

export const MAILPIT = process.env.E2E_MAILPIT ?? 'http://localhost:8025'
export const API = process.env.E2E_API ?? process.env.E2E_URL ?? 'http://localhost:3000'
export const PASSWORD = 'a-password-for-e2e'

// A fresh address per test, so runs never collide with an earlier account.
export const newAddress = (name = 'e2e') =>
  `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

// The newest email to the address that has a link matching the pattern, waiting until it arrives.
export const emailedLink = async (request, address, pattern) => {
  let link

  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(address)}`)
        const [message] = (await search.json()).messages ?? []
        if (message == null) return

        const body = await (await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)).json()
        link = body.Text.match(pattern)?.[0]

        return link
      },
      { timeout: 15_000 },
    )
    .toBeTruthy()

  return link
}

// Opening mail links is limited per address, see createAccount
export const ownAddress = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`

export const confirmationLink = (request, address) =>
  emailedLink(request, address, /https?:\/\/\S+\/verify\?token=[\w-]+/)

export const fillCredentials = async (page, address, password = PASSWORD) => {
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByPlaceholder(/password/i).fill(password)
}

export const signIn = async (page, address, password = PASSWORD) => {
  await page.goto('/')
  await fillCredentials(page, address, password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

// Registers a new address, follows the emailed link and signs in. Returns the address.
export const createAccount = async (page, request, name) => {
  const address = newAddress(name)

  await page.goto('/')
  await page.getByText('Create account', { exact: true }).click()
  await fillCredentials(page, address)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByText(/check your email for a confirmation link/i)).toBeVisible()

  // Opening links is limited to 30 a quarter of an hour for one address (ACKEE-65). Every test
  // comes from its own, as if from behind a proxy.
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': ownAddress() })
  await page.goto(await confirmationLink(request, address))
  await expect(page.getByRole('heading', { name: 'Address confirmed' })).toBeVisible()
  await page.context().setExtraHTTPHeaders({})

  await signIn(page, address)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()

  return address
}

// GraphQL from the signed-in Ackee page, with its own session
export const graphql = (page, query, variables) =>
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

// The tracker ignores headless browsers as bots, so the visitor looks like a regular Chrome
export const VISITOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

export const createDomain = async (page, title) => {
  const { data } = await graphql(
    page,
    'mutation($input: CreateDomainInput!) { createDomain(input: $input) { payload { id title ingestKey } } }',
    { input: { title } },
  )

  return data.createDomain.payload
}

// One view as the tracker sends it. Returns the GraphQL answer. The visitor is told by the
// address and the browser, so another visitor number is another browser version.
export const sendView = async (request, domain, path, { headers = {}, referrer, visitor = 0, api = API } = {}) => {
  const response = await request.post(`${api}/api`, {
    headers: {
      'User-Agent': VISITOR.replace('141.0.0.0', `${141 + visitor}.0.0.0`),
      'Origin': `http://${domain.title}`,
      ...(domain.ingestKey == null ? {} : { 'X-Ackee-Key': domain.ingestKey }),
      ...headers,
    },
    data: {
      query: `mutation($domainId: ID!, $input: CreateRecordInput!) {
        createRecord(domainId: $domainId, input: $input) { success payload { id } }
      }`,
      variables: {
        domainId: domain.id,
        input: {
          siteLocation: `http://${domain.title}${path}`,
          ...(referrer == null ? {} : { siteReferrer: referrer }),
          siteLanguage: 'en',
          screenWidth: 1920,
          screenHeight: 1080,
        },
      },
    },
  })

  return response.json()
}

export const invitationLink = (request, address) =>
  emailedLink(request, address, /https?:\/\/\S+\/invitation\?token=[\w-]+/)

// The owner invites an address from the settings. The role is VIEWER, EDITOR or OWNER.
export const invite = async (page, address, role = 'VIEWER') => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Invite member' }).click()
  await page.getByPlaceholder('name@example.com').fill(address)
  await page.getByLabel('Role').selectOption(role)
  await page.getByRole('button', { name: 'Send invitation' }).click()
}

// The invited person in a browser of their own: opens the link, sets a password, signs in.
// Returns the page, signed in.
export const joinByInvitation = async (browser, link, address) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_URL ?? 'http://localhost:3000' })
  const page = await context.newPage()

  await context.setExtraHTTPHeaders({
    'X-Forwarded-For': `10.${Math.floor(Math.random() * 250)}.7.${Math.floor(Math.random() * 250) + 1}`,
  })
  await page.goto(link)
  await page.getByLabel('New password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByRole('heading', { name: 'Invitation accepted' })).toBeVisible()
  await context.setExtraHTTPHeaders({})

  await signIn(page, address)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()

  return page
}
