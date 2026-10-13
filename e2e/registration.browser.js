import { expect, test } from '@playwright/test'

const MAILPIT = process.env.E2E_MAILPIT ?? 'http://localhost:8025'
const PASSWORD = 'a-password-for-e2e'

// A fresh address per test, so runs never collide with an earlier account.
const newAddress = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

// The confirmation link from the newest email to the address, waiting until it arrives.
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

const fill = async (page, address, password) => {
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByPlaceholder(/password/i).fill(password)
}

const register = async (page, address) => {
  await page.goto('/')
  await page.getByText('Create account', { exact: true }).click()
  await fill(page, address, PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByText(/check your email for a confirmation link/i)).toBeVisible()
}

const signIn = async (page, address, password) => {
  await page.goto('/')
  await fill(page, address, password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

test('register, confirm by the emailed link, sign in', async ({ page, request }) => {
  const address = newAddress()

  await register(page, address)

  const link = await confirmationLink(request, address)
  await page.goto(link)
  await expect(page.getByRole('heading', { name: 'Address confirmed' })).toBeVisible()

  await signIn(page, address, PASSWORD)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('an unconfirmed address is told to confirm first', async ({ page }) => {
  const address = newAddress()

  await register(page, address)
  await signIn(page, address, PASSWORD)

  await expect(page.getByText(/confirm your email address before signing in/i)).toBeVisible()
})

test('a wrong password is refused with a clear message', async ({ page, request }) => {
  const address = newAddress()

  await register(page, address)
  await page.goto(await confirmationLink(request, address))
  await signIn(page, address, 'not-the-password')

  await expect(page.getByText(/username or password incorrect/i)).toBeVisible()
})
