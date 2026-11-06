import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { API, createAccount, createDomain, sendView } from './_helpers.js'

test('a report card saves its report as CSV that Excel reads, and as JSON', async ({ page, request }) => {
  await createAccount(page, request, 'export')
  const domain = await createDomain(page, 'shop.test')
  await sendView(request, domain, '/кошик', { referrer: 'https://новини.example/', visitor: 0 })
  await page.reload()

  await page.getByRole('link', { name: 'Traffic' }).click()
  await page.getByRole('tab', { name: 'Pages' }).click()
  await expect(page.locator('main')).toContainText('shop.test')

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download shop.test as CSV' }).click(),
  ])
  expect(csv.suggestedFilename()).toMatch(/^ackee-pages-\d{4}-\d{2}-\d{2}\.csv$/)
  const file = await readFile(await csv.path())
  // UTF-8 with a byte order mark: Excel shows the Cyrillic of the address
  expect([...file.subarray(0, 3)]).toEqual([239, 187, 191])
  const lines = file.subarray(3).toString('utf8').split('\r\n')
  expect(lines[0]).toBe('value,count,created')
  expect(decodeURI(lines[1])).toContain('http://shop.test/кошик,1,')

  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download shop.test as JSON' }).click(),
  ])
  const entries = JSON.parse(await readFile(await json.path(), 'utf8'))
  expect(entries.map((entry) => [decodeURI(entry.value), entry.count])).toEqual([['http://shop.test/кошик', 1]])
})

test('the export answers nobody without a token', async ({ request }) => {
  expect((await request.get(`${API}/export/pages.csv`)).status()).toBe(401)
  expect((await request.get(`${API}/export/unknown.csv`)).status()).toBe(404)
})
