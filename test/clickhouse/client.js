import test from 'ava'

import { close, getClient, ping } from '../../src/clickhouse/client.js'

test.after.always(close)

test('ping resolves when ClickHouse is reachable', async (t) => {
  await t.notThrowsAsync(ping)
})

test('returns the same client instance for the whole process', (t) => {
  t.is(getClient(), getClient())
})
