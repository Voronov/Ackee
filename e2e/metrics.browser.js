import { expect, test } from '@playwright/test'

import { API, createAccount, graphql } from './_helpers.js'

const TOKEN = process.env.E2E_METRICS_TOKEN ?? 'e2e-metrics-token'

test('metrics are served only to the token, and count what the stand does', async ({ page, request }) => {
  // Without the token the endpoint is not there, as for any address that is not ours
  expect((await request.get(`${API}/metrics`)).status()).toBe(404)
  expect((await request.get(`${API}/metrics`, { headers: { Authorization: 'Bearer wrong' } })).status()).toBe(404)

  // One request of a signed-in user, so there is something to count
  await createAccount(page, request, 'metrics')
  await graphql(page, '{ domains { id } }')

  const answer = await request.get(`${API}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  expect(answer.status()).toBe(200)

  const text = await answer.text()
  expect(text).toContain('ackee_http_request_duration_seconds')
  expect(text).toContain('ackee_graphql_operation_duration_seconds')
  expect(text).toContain('ackee_mongodb_command_duration_seconds')
})
