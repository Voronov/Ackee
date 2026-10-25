import { expect, test } from '@playwright/test'

import { PASSWORD, createAccount, emailedLink, fillCredentials, graphql, ownAddress, signIn } from './_helpers.js'

const NEW_PASSWORD = 'another-password-for-e2e'

test('a forgotten password is changed by the emailed link, and the old one stops working', async ({
  page,
  request,
}) => {
  const address = await createAccount(page, request, 'reset')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()

  await expect(page.getByText('Sign in with a passkey')).toBeVisible()
  await page.getByText(/forgot password/i).click()
  await page.getByPlaceholder(/email/i).fill(address)
  await page.getByRole('button', { name: /send link/i }).click()

  const link = await emailedLink(request, address, /https?:\/\/\S+\/reset\?token=[\w-]+/)
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': ownAddress() })
  await page.goto(link)
  await page.getByLabel('New password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible()
  await page.context().setExtraHTTPHeaders({})

  await signIn(page, address, PASSWORD)
  await expect(page.getByText(/wrong|incorrect|invalid/i)).toBeVisible()

  await page.goto('/')
  await fillCredentials(page, address, NEW_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('a permanent token works for the API until it is deleted', async ({ page, request }) => {
  await createAccount(page, request, 'token')
  await page.getByRole('button', { name: 'Settings' }).click()

  await page.getByRole('button', { name: 'New permanent token' }).click()
  await page.getByPlaceholder('Permanent token title').fill('ci-script')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: /ci-script/ })).toBeVisible()

  const [{ id }] = (await graphql(page, '{ permanentTokens { id title } }')).data.permanentTokens
  const ask = async () =>
    (
      await request.post(`${process.env.E2E_API ?? 'http://localhost:3000'}/api`, {
        headers: { Authorization: `Bearer ${id}` },
        data: { query: '{ domains { id } }' },
      })
    ).json()

  expect((await ask()).data.domains).toEqual([])

  // Deleting asks for a confirmation of the browser
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /ci-script/ }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: /ci-script/ })).toHaveCount(0)

  await expect.poll(async () => (await ask()).errors?.[0]?.message).toBeTruthy()
})
