import { expect, test } from '@playwright/test'

import { API, createAccount, graphql } from './_helpers.js'

test('an event is created in the settings and its actions are summed in the insights', async ({ page, request }) => {
  await createAccount(page, request, 'events')
  await page.getByRole('button', { name: 'Settings' }).click()

  await page.getByRole('button', { name: 'New event' }).click()
  await page.getByPlaceholder('Event title').fill('Order value')
  await page.getByLabel('Event type').selectOption({ label: 'List with total sums' })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: /Order value/ })).toBeVisible()

  const [event] = (await graphql(page, '{ events { id title } }')).data.events
  expect(event.title).toBe('Order value')

  // The site reports actions of the event without signing in
  for (const value of [10, 20.5]) {
    const answer = await request.post(`${API}/api`, {
      data: {
        query:
          'mutation($eventId: ID!, $input: CreateActionInput!) { createAction(eventId: $eventId, input: $input) { success } }',
        variables: { eventId: event.id, input: { key: 'sku-1', value } },
      },
    })
    expect((await answer.json()).data.createAction.success).toBe(true)
  }

  await page.goto('/#/insights/events')
  await expect(page.locator('main')).not.toContainText('Loading')
  await expect(page.locator('main')).toContainText('Order value')
  await expect(page.locator('main')).toContainText('sku-1')
  await expect(page.locator('main')).toContainText('30.50')
})
