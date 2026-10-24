import { expect, test } from '@playwright/test'

const MAILPIT = process.env.E2E_MAILPIT ?? 'http://localhost:8025'
const PASSWORD = 'a-password-for-e2e'

const newAddress = () => `e2e-passkey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

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

test('add a passkey in the settings, sign out, sign in with it', async ({ page, request }) => {
  // A platform authenticator in the browser that says yes to every prompt (Touch ID in a test)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

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

  await page.getByRole('button', { name: 'Settings' }).click()
  page.once('dialog', (dialog) => dialog.accept('Test key'))
  await page.getByRole('button', { name: 'Add passkey' }).click()
  await expect(page.getByRole('button', { name: /Test key/ })).toBeVisible()

  await page.getByRole('button', { name: 'Sign Out' }).click()
  await page.getByText('Sign in with a passkey').click()

  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  // The sign-in used the key: its row no longer says "never used"
  await expect(page.getByRole('button', { name: /Test key/ })).not.toContainText('never used')
})
