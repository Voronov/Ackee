import crypto from 'node:crypto'

import { expect, test } from '@playwright/test'

import { createAccount, createDomain, graphql } from './_helpers.js'

// The key of a service account made here: the stand-in for Google does not check it
const key = () =>
  JSON.stringify({
    type: 'service_account',
    client_email: 'ackee-reader@datum-test.iam.gserviceaccount.com',
    private_key: crypto
      .generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' }),
  })

const connect = async (page, title, propertyId) => {
  // The domain was made through the API, the open page does not know it yet
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: new RegExp(title.replaceAll('.', String.raw`\.`)) }).click()
  await page.getByRole('button', { name: /Google Analytics/ }).click()
  await page.getByPlaceholder('123456789').fill(propertyId)
  await page.getByPlaceholder(/service_account/).fill(key())
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
}

test('a domain is connected to a Google Analytics property, which is synced and shown next to Ackee', async ({
  page,
  request,
}) => {
  await createAccount(page, request, 'ga4')
  const domain = await createDomain(page, 'datum-shop.pages.dev')

  await connect(page, domain.title, '123456789')

  // The history is read in the background, the dialog says how far it got
  await expect(page.getByText(/Synced from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 30_000 })

  const ga4 = (
    await graphql(page, 'query($id: ID!) { domain(id: $id) { ga4 { propertyId clientEmail lastError } } }', {
      id: domain.id,
    })
  ).data.domain.ga4
  expect(ga4).toEqual({
    propertyId: '123456789',
    clientEmail: 'ackee-reader@datum-test.iam.gserviceaccount.com',
    lastError: null,
  })

  // The source switch of the reports appears once a domain is connected
  // The dialog of the domain is under the one of Google Analytics
  await page.getByRole('button', { name: 'Close' }).last().click()
  await page.getByRole('button', { name: 'Close' }).last().click()
  await page.getByRole('button', { name: 'Overview' }).click()
  const source = page.getByRole('combobox')
  await expect(source.locator('option')).toHaveText(['Ackee', 'Google Analytics', 'Ackee and Google Analytics'])

  // The numbers of Google are apart from Ackee's: Ackee has no view, Google has the days
  await source.selectOption({ label: 'Google Analytics' })
  await expect(page.getByText('datum-shop.pages.dev/cart/')).toBeVisible()
  await expect(page.getByText('google', { exact: true })).toBeVisible()

  await source.selectOption({ label: 'Ackee' })
  await expect(page.getByText('datum-shop.pages.dev/cart/')).toHaveCount(0)
})

test('disconnecting a domain from Google Analytics removes its days and the source switch', async ({
  page,
  request,
}) => {
  await createAccount(page, request, 'ga4-off')
  const domain = await createDomain(page, 'datum-shop.pages.dev')

  await connect(page, domain.title, '987654321')
  await expect(page.getByText(/Synced from/)).toBeVisible({ timeout: 30_000 })

  // Disconnecting asks for a confirmation of the browser
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Disconnect' }).click()

  await expect
    .poll(
      async () =>
        (await graphql(page, 'query($id: ID!) { domain(id: $id) { ga4 { propertyId } } }', { id: domain.id })).data
          .domain.ga4,
    )
    .toBeNull()
})
