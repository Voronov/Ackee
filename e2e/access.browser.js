import { expect, test } from '@playwright/test'

import { API, createAccount, createDomain, graphql } from './_helpers.js'

const ask = async (request, query, token) =>
  (
    await request.post(`${API}/api`, {
      headers: token == null ? {} : { Authorization: `Bearer ${token}` },
      data: { query },
    })
  ).json()

test('what belongs to an account needs its token', async ({ request }) => {
  for (const query of [
    '{ domains { id } }',
    '{ events { id } }',
    '{ workspaces { id } }',
    '{ permanentTokens { id } }',
  ]) {
    expect((await ask(request, query)).errors[0].message).toBe('Token missing')
    expect((await ask(request, query, 'not-a-token')).errors[0].message).toBe('Token invalid')
  }

  // The live feed and the metrics do not talk to a stranger either
  expect((await request.get(`${API}/api/live`)).status()).toBe(401)
  expect((await request.get(`${API}/api/live`, { headers: { Authorization: 'Bearer nope' } })).status()).toBe(401)
  expect((await request.get(`${API}/metrics`)).status()).toBe(404)
})

test('a mistyped field gets no suggestion, so the schema is not given away', async ({ request }) => {
  const answer = await ask(request, '{ permanentTokenz { id } }')

  expect(answer.errors[0].message).not.toMatch(/did you mean/i)
})

test('another account sees nothing of a domain and cannot change or delete it', async ({ browser, page, request }) => {
  await createAccount(page, request, 'owner')
  const domain = await createDomain(page, 'private.test')

  const context = await browser.newContext({ baseURL: process.env.E2E_URL ?? 'http://localhost:3000' })
  const stranger = await context.newPage()
  await createAccount(stranger, request, 'stranger')

  const own = await graphql(stranger, '{ domains { id } }')
  expect(own.data.domains).toEqual([])

  const read = await graphql(stranger, 'query($id: ID!) { domain(id: $id) { title } }', { id: domain.id })
  expect(read.data?.domain ?? null).toBeNull()

  const rename = await graphql(
    stranger,
    'mutation($id: ID!) { updateDomain(id: $id, input: { title: "hijacked.test" }) { success } }',
    { id: domain.id },
  )
  expect(rename.errors).toBeDefined()

  const remove = await graphql(stranger, 'mutation($id: ID!) { deleteDomain(id: $id) { success } }', { id: domain.id })
  expect(remove.errors).toBeDefined()

  // The domain is as the owner left it
  const kept = await graphql(page, '{ domains { id title } }')
  expect(kept.data.domains).toEqual([{ id: domain.id, title: 'private.test' }])

  await context.close()
})
