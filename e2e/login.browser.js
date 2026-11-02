import { expect, test } from '@playwright/test'

import { PASSWORD, createAccount, emailedLink, fillCredentials, newAddress, signIn } from './_helpers.js'

test('an address is registered only with a password of ten characters', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Create account', { exact: true }).click()
  await fillCredentials(page, newAddress('short'), 'only-nine')
  await page.getByRole('button', { name: /create account/i }).click()

  await expect(page.getByText('Password must be at least 10 characters long')).toBeVisible()
  await expect(page.getByText(/check your email/i)).toHaveCount(0)
})

test('five wrong passwords lock the address, the right one is not accepted meanwhile', async ({ page, request }) => {
  const address = await createAccount(page, request, 'lock')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page.getByText('Sign in with a passkey')).toBeVisible()

  for (let attempt = 0; attempt < 5; attempt++) {
    await fillCredentials(page, address, `wrong-password-${attempt}`)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Username or password incorrect')).toBeVisible()
  }

  await signIn(page, address, PASSWORD)
  await expect(page.getByText(/too many failed sign-ins/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0)
})

test('registering an address that has an account does not touch the account', async ({ page, request }) => {
  const address = await createAccount(page, request, 'twice')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()

  await page.getByText('Create account', { exact: true }).click()
  await fillCredentials(page, address, 'another-password-for-e2e')
  await page.getByRole('button', { name: /create account/i }).click()

  // The same answer as for a new address, so the form does not tell who has an account here.
  // The owner is told by email instead.
  await expect(page.getByText(/check your email for a confirmation link/i)).toBeVisible()
  await emailedLink(request, address, /already have an Ackee account/)

  // The first password still works, the second never did
  await signIn(page, address, PASSWORD)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page.getByText('Sign in with a passkey')).toBeVisible()
  await signIn(page, address, 'another-password-for-e2e')
  await expect(page.getByText('Username or password incorrect')).toBeVisible()
})

test('asking for a new password says the same for a known and an unknown address', async ({ page, request }) => {
  const known = await createAccount(page, request, 'forgot')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign Out' }).click()

  await expect(page.getByText('Sign in with a passkey')).toBeVisible()
  const answers = []

  for (const address of [known, newAddress('nobody')]) {
    await page.goto('/')
    await expect(page.getByText('Sign in with a passkey')).toBeVisible()
    await page.getByText(/forgot password/i).click()
    await page.getByPlaceholder(/email/i).fill(address)
    await page.getByRole('button', { name: /send link/i }).click()

    const note = page.getByText(/a link is on its way/i)
    await expect(note).toBeVisible()
    answers.push(await note.textContent())
  }

  expect(answers[0]).toBe(answers[1])
})
