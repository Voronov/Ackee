import { expect, test } from '@playwright/test'

import { createAccount, createDomain, graphql, sendView } from './_helpers.js'

const addDomain = async (page, title) => {
  await page.getByRole('button', { name: 'New domain' }).click()
  await page.getByPlaceholder('Domain title').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(title.replace('.', String.raw`\.`)) })).toBeVisible()
}

test('a new domain gets an id and an embed code, can be renamed and then deleted', async ({ page, request }) => {
  await createAccount(page, request, 'domains')
  await page.getByRole('button', { name: 'Settings' }).click()

  await addDomain(page, 'shop.test')

  // The id and the snippet of the domain are in its dialog
  await page.getByRole('button', { name: /shop\.test/ }).click()
  const id = await page.getByLabel('Domain id').inputValue()
  expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/)
  await expect(page.getByLabel('Embed code', { exact: true })).toHaveValue(new RegExp(String.raw`tracker\.js.*${id}`))

  await page.getByLabel('Domain title').fill('webshop.test')
  await page.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('button', { name: /webshop\.test/ })).toBeVisible()
  await expect
    .poll(async () => (await graphql(page, '{ domains { id title } }')).data.domains)
    .toEqual([{ id, title: 'webshop.test' }])

  // Deleting asks for a confirmation of the browser
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /webshop\.test/ }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: /webshop\.test/ })).toHaveCount(0)
  await expect.poll(async () => (await graphql(page, '{ domains { id } }')).data.domains).toEqual([])
})

test('two domains of one account are listed side by side', async ({ page, request }) => {
  await createAccount(page, request, 'domains-two')
  await page.getByRole('button', { name: 'Settings' }).click()

  await addDomain(page, 'first.test')
  await addDomain(page, 'second.test')

  await expect
    .poll(async () =>
      (await graphql(page, '{ domains { title } }')).data.domains.map((domain) => domain.title).toSorted(),
    )
    .toEqual(['first.test', 'second.test'])
})

test('a deleted domain takes no more views', async ({ page, request }) => {
  await createAccount(page, request, 'domains-gone')
  const domain = await createDomain(page, 'gone.test')

  expect((await sendView(request, domain, '/')).errors).toBeUndefined()
  await graphql(page, 'mutation($id: ID!) { deleteDomain(id: $id) { success } }', { id: domain.id })

  expect((await sendView(request, domain, '/')).errors[0].message).toBe('Unknown domain')
  expect(
    (await graphql(page, 'query($id: ID!) { domain(id: $id) { id } }', { id: domain.id })).data?.domain ?? null,
  ).toBeNull()
})
