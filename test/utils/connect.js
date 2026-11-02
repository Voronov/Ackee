import test from 'ava'
import mockedEnv from 'mocked-env'

import { connectionOptions } from '../../src/utils/connect.js'

test.serial('the driver reports its commands only while metrics are on', (t) => {
  const off = mockedEnv({ ACKEE_METRICS_TOKEN: undefined })
  t.false(connectionOptions().monitorCommands)
  off()

  const on = mockedEnv({ ACKEE_METRICS_TOKEN: 'secret' })
  t.true(connectionOptions().monitorCommands)
  on()
})
