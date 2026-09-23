import test from 'ava'
import mockedEnv from 'mocked-env'

import { close, ping } from '../../src/clickhouse/client.js'

// Nothing listens on port 1, so the connection is refused immediately
const restore = mockedEnv({ ACKEE_CLICKHOUSE_URL: 'http://localhost:1' })

test.after.always(async () => {
  await close()
  restore()
})

test('ping throws a clear error when ClickHouse is unreachable', async (t) => {
  await t.throwsAsync(ping, {
    message: 'ClickHouse at http://localhost:1 is unreachable: ECONNREFUSED',
  })
})
