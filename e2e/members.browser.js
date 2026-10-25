import { expect, test } from '@playwright/test'

import {
  createAccount,
  createDomain,
  graphql,
  invitationLink,
  invite,
  joinByInvitation,
  newAddress,
  sendView,
} from './_helpers.js'

// An owner with a domain that has a view, and a guest invited as a viewer who has joined
const withGuest = async (browser, page, request) => {
  await createAccount(page, request, 'owner')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/cart')

  const address = newAddress('guest')
  await invite(page, address, 'VIEWER')
  const link = await invitationLink(request, address)
  const guest = await joinByInvitation(browser, link, address)

  return { domain, address, link, guest }
}

test('an invitation is pending until the person joins, then the person is a member', async ({
  browser,
  page,
  request,
}) => {
  await createAccount(page, request, 'owner')
  const address = newAddress('guest')

  await invite(page, address, 'EDITOR')
  await expect(page.getByRole('button', { name: /invited · EDITOR/ })).toBeVisible()

  const guest = await joinByInvitation(browser, await invitationLink(request, address), address)

  await page.reload()
  await expect(page.getByRole('button', { name: new RegExp(`${address}.*EDITOR`) })).toBeVisible()
  await expect(page.getByRole('button', { name: /invited · EDITOR/ })).toHaveCount(0)

  await guest.context().close()
})

test('a viewer reads the reports of the workspace but cannot change its domains', async ({
  browser,
  page,
  request,
}) => {
  const { domain, guest } = await withGuest(browser, page, request)

  // The views of the owner are in the reports of the guest
  await guest.goto('/')
  await expect(guest.getByText('http://shop.test/cart')).toBeVisible()

  const answer = await graphql(guest, 'mutation($id: ID!) { deleteDomain(id: $id) { success } }', { id: domain.id })
  expect(answer.errors).toBeDefined()

  const domains = await graphql(page, '{ domains { id } }')
  expect(domains.data.domains).toEqual([{ id: domain.id }])

  await guest.context().close()
})

test('the invitation link works once', async ({ browser, page, request }) => {
  const { link, guest } = await withGuest(browser, page, request)

  await guest.goto(link)
  await expect(guest.getByText(/already used|no longer valid|expired/i)).toBeVisible()

  await guest.context().close()
})

test('a member removed by the owner loses the reports', async ({ browser, page, request }) => {
  const { address, domain, guest } = await withGuest(browser, page, request)

  await expect.poll(async () => (await graphql(guest, '{ domains { id } }')).data.domains).toEqual([{ id: domain.id }])

  // Removing asks for a confirmation of the browser
  page.on('dialog', (dialog) => dialog.accept())
  // The list of the owner does not know yet that the invitation was used
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: new RegExp(`${address}.*VIEWER`) }).click()
  await expect(page.getByRole('button', { name: new RegExp(`${address}.*VIEWER`) })).toHaveCount(0)

  await expect.poll(async () => (await graphql(guest, '{ domains { id } }')).data.domains).toEqual([])

  await guest.context().close()
})
