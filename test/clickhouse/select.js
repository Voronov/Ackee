import test from 'ava'

import { close } from '../../src/clickhouse/client.js'
import select from '../../src/stores/clickhouse/reports/select.js'
import signale from '../../src/utils/signale.js'

test.after.always(close)

test('returns 64-bit integers as numbers', async (t) => {
  const rows = await select('SELECT count() AS count, toUnixTimestamp64Milli(now64(3)) AS at FROM system.one', {})

  t.is(rows.length, 1)
  t.is(rows[0].count, 1)
  t.is(typeof rows[0].at, 'number')
})

test.serial('hides the ClickHouse error from the caller and logs it instead', async (t) => {
  const logged = []
  const original = signale.error
  signale.error = (message) => logged.push(message)

  try {
    await t.throwsAsync(select('SELECT missingColumn FROM system.one', {}), {
      message: 'Report query failed',
    })
  } finally {
    signale.error = original
  }

  // The client library logs the failed request on its own first
  t.true(logged.at(-1).startsWith('ClickHouse report query failed: '))
  t.true(logged.at(-1).includes('missingColumn'))
})
