import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import server from '../src/workerServer.js'

const base = listen(server)

test.after.always(() => server.close())

test('a worker answers the health check of the image and nothing else', async (t) => {
  const root = await fetch(await base)
  t.is(root.status, 200)
  t.is(await root.text(), 'Ackee worker')

  // The query that healthcheck.js sends to the API
  const health = await fetch(new URL('/api', await base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{__typename}' }),
  })
  t.is(health.status, 200)
  t.deepEqual(await health.json(), { data: { __typename: 'Query' } })

  t.is((await fetch(new URL('/index.js', await base))).status, 404)
})

test.serial('a worker serves its metrics to the token', async (t) => {
  const restore = mockedEnv({ ACKEE_METRICS_TOKEN: 'secret' })

  t.is((await fetch(new URL('/metrics', await base))).status, 404)
  const answer = await fetch(new URL('/metrics', await base), { headers: { Authorization: 'Bearer secret' } })
  t.is(answer.status, 200)
  t.true((await answer.text()).includes('ackee_ingest_queue_processed_total'))

  restore()
})
