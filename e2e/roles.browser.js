import { expect, test } from '@playwright/test'

import {
  createAccount,
  createDomain,
  graphql,
  invitationLink,
  invite,
  joinByInvitation,
  newAddress,
} from './_helpers.js'

const RENAME = 'mutation($id: ID!) { updateDomain(id: $id, input: { title: "renamed.test" }) { success } }'
const DELETE = 'mutation($id: ID!) { deleteDomain(id: $id) { success } }'
const INVITE = 'mutation($input: InviteMemberInput!) { inviteMember(input: $input) { success } }'

// An owner with a domain, and a guest of the workspace with the role
const withGuest = async (browser, page, request, role) => {
  await createAccount(page, request, 'owner')
  const domain = await createDomain(page, 'shop.test')
  const [{ id: workspaceId }] = (await graphql(page, '{ workspaces { id } }')).data.workspaces

  const address = newAddress(role.toLowerCase())
  await invite(page, address, role)
  const guest = await joinByInvitation(browser, await invitationLink(request, address), address)

  const invitation = () =>
    graphql(guest, INVITE, { input: { workspaceId, email: newAddress('friend'), role: 'VIEWER' } })

  return { domain, guest, invitation }
}

test('a viewer reads the domains and changes nothing', async ({ browser, page, request }) => {
  const { domain, guest, invitation } = await withGuest(browser, page, request, 'VIEWER')

  expect((await graphql(guest, '{ domains { id } }')).data.domains).toEqual([{ id: domain.id }])
  expect((await graphql(guest, RENAME, { id: domain.id })).errors).toBeDefined()
  expect((await graphql(guest, DELETE, { id: domain.id })).errors).toBeDefined()
  expect((await invitation()).errors).toBeDefined()

  await guest.context().close()
})

test('an editor manages the domains but does not invite', async ({ browser, page, request }) => {
  const { domain, guest, invitation } = await withGuest(browser, page, request, 'EDITOR')

  expect((await graphql(guest, RENAME, { id: domain.id })).errors).toBeUndefined()
  expect((await graphql(page, '{ domains { title } }')).data.domains).toEqual([{ title: 'renamed.test' }])
  expect((await invitation()).errors).toBeDefined()

  // The editor does not see the members of the workspace in the settings
  await guest.getByRole('button', { name: 'Settings' }).click()
  await expect(guest.getByRole('button', { name: 'Invite member' })).toHaveCount(0)

  await guest.context().close()
})

test('a second owner invites like the first one', async ({ browser, page, request }) => {
  const { guest, invitation } = await withGuest(browser, page, request, 'OWNER')

  expect((await invitation()).errors).toBeUndefined()

  await guest.getByRole('button', { name: 'Settings' }).click()
  // One card for the workspace of their own, one for the shared one
  await expect(guest.getByRole('button', { name: 'Invite member' })).toHaveCount(2)

  await guest.context().close()
})

test('an invitation limited to a domain gives only that domain', async ({ browser, page, request }) => {
  await createAccount(page, request, 'owner')
  const first = await createDomain(page, 'first.test')
  await createDomain(page, 'second.test')

  const address = newAddress('limited')
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Invite member' }).click()
  await page.getByPlaceholder('name@example.com').fill(address)
  await page.getByLabel('Role').selectOption('VIEWER')
  await page.getByLabel('first.test').check()
  await page.getByRole('button', { name: 'Send invitation' }).click()

  const guest = await joinByInvitation(browser, await invitationLink(request, address), address)

  // The guest has a workspace of their own, which is empty
  expect((await graphql(guest, '{ domains { id title } }')).data.domains).toEqual([
    { id: first.id, title: 'first.test' },
  ])

  await guest.context().close()
})
