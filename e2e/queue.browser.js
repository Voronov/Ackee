import { expect, test } from '@playwright/test'

import { ownAddress, sendView } from './_helpers.js'

// Ackee with the ingest queue on (ADR-006), in its own container and database, driven through
// its API: the views go through Redis and a worker stores them. The administrator of the
// environment makes the domain, nobody registers here.
const QUEUE = process.env.E2E_QUEUE_API ?? 'http://localhost:3001'
// The worker is a process of its own (ACKEE-19); what it wrote is counted on its /metrics
const WORKER = process.env.E2E_QUEUE_WORKER_API ?? QUEUE
const TOKEN = process.env.E2E_METRICS_TOKEN ?? 'e2e-metrics-token'

const call = async (request, query, variables, token, headers = {}) =>
  (
    await request.post(`${QUEUE}/api`, {
      headers: { ...(token == null ? {} : { Authorization: `Bearer ${token}` }), ...headers },
      data: { query, variables },
    })
  ).json()

const administrator = async (request) => {
  const { data } = await call(
    request,
    'mutation($input: CreateTokenInput!) { createToken(input: $input) { payload { id } } }',
    { input: { username: 'queue-admin', password: 'a-password-for-the-queue-e2e' } },
  )

  return data.createToken.payload.id
}

test('views go through the queue and are stored by the worker', async ({ request }) => {
  const token = await administrator(request)
  const { data } = await call(
    request,
    'mutation($input: CreateDomainInput!) { createDomain(input: $input) { payload { id title ingestKey } } }',
    { input: { title: 'queue.test' } },
    token,
  )
  const domain = data.createDomain.payload

  // Three visitors. The tracker is answered with the id at once, whether the worker is done or not.
  for (const visitor of [0, 1, 2]) {
    const answer = await sendView(request, domain, `/page-${visitor}`, { visitor, api: QUEUE })
    expect(answer.errors).toBeUndefined()
    expect(answer.data.createRecord.success).toBe(true)
  }

  await expect
    .poll(
      async () =>
        (await call(request, 'query($id: ID!) { domain(id: $id) { facts { viewsToday } } }', { id: domain.id }, token))
          .data.domain.facts.viewsToday,
    )
    .toBe(3)

  // The worker counted what it stored, and dropped nothing as broken
  const metrics = await (
    await request.get(`${WORKER}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  ).text()
  const stored = /ackee_ingest_queue_processed_total\{type="record\.create",app="ackee"\} (\d+)/.exec(metrics)[1]
  expect(Number(stored)).toBeGreaterThanOrEqual(3)
  expect(metrics).toContain('ackee_ingest_queue_dropped_total{reason="invalid",app="ackee"} 0')
})

test('one address may send only so many touches a minute', async ({ request }) => {
  const token = await administrator(request)
  const id = '00000000-0000-4000-8000-000000000000'
  // The touches of this test come from an address of their own, the count is per address
  const headers = { 'X-Forwarded-For': ownAddress() }
  const touch = () => call(request, 'mutation($id: ID!) { updateRecord(id: $id) { success } }', { id }, token, headers)

  // The limit of this container is 5. The touches of made-up ids are accepted until then.
  for (let sent = 0; sent < 5; sent++) expect((await touch()).errors).toBeUndefined()

  expect((await touch()).errors[0].message).toBe('Too many requests')
})
