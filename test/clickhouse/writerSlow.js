import test from 'ava'
import mockedEnv from 'mocked-env'
import { randomUUID as uuid } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

import { close } from '../../src/clickhouse/client.js'
import { batchSize, flush, push, size } from '../../src/stores/clickhouse/writer.js'

// A stand-in for ClickHouse that takes long enough to answer an insert for the
// flush timer to fire while the insert is still in flight
const insertDelay = 1200

const inserts = []

const readBody = async (request) => {
  let body = ''
  for await (const chunk of request) body += chunk
  return body
}

const fakeClickHouse = createServer(async (request, response) => {
  const body = await readBody(request)
  inserts.push({ rows: body.split('\n').filter((line) => line !== '').length, at: Date.now() })

  await sleep(insertDelay)
  response.writeHead(200).end()
})

const row = () => ({ id: uuid(), domainId: 'domain', created: new Date().toISOString(), version: 1 })

const pollUntil = async (read, expected, deadline) => {
  let value

  for (let elapsed = 0; elapsed <= deadline; elapsed += 50) {
    value = read()
    if (value === expected) return value
    await sleep(50)
  }

  return value
}

let restore

test.before(async () => {
  fakeClickHouse.listen(0, '127.0.0.1')
  await once(fakeClickHouse, 'listening')

  const { port } = fakeClickHouse.address()
  restore = mockedEnv({ ACKEE_CLICKHOUSE: `http://127.0.0.1:${port}` })
})

test.after.always(async () => {
  await flush()
  await close()
  fakeClickHouse.close()
  restore()
})

test('inserts a row pushed during an in-flight flush on the timer without an explicit flush', async (t) => {
  for (let index = 0; index < batchSize; index++) push('records', row())

  t.is(await pollUntil(() => inserts.length, 1, 500), 1)
  t.is(size(), 0)

  const pushedAt = Date.now()
  push('records', row())

  t.is(size(), 1)
  t.is(await pollUntil(() => inserts.length, 2, 3000), 2)
  t.deepEqual(
    inserts.map(({ rows }) => rows),
    [batchSize, 1],
  )
  t.true(inserts[1].at - pushedAt <= 3000)
  t.is(size(), 0)
})
