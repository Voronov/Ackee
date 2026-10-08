import test from 'ava'
import mockedEnv from 'mocked-env'

import { check, isEnabled, send } from '../../src/utils/mailer.js'

// Serial: the transport is created once and reused, so the order of these tests matters.
test.serial('mail is off without an SMTP host', async (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: undefined })

  t.false(isEnabled())
  t.false(await send({ to: 'someone@example.com', subject: 'Test', text: 'Test' }))
  t.false(await check())

  restore()
})

// A failed email must not break the request that triggered it.
test.serial('an unreachable SMTP server makes send return false instead of throwing', async (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: 'smtp.invalid', ACKEE_SMTP_PORT: '465' })

  t.true(isEnabled())
  t.false(await send({ to: 'someone@example.com', subject: 'Test', text: 'Test' }))
  t.false(await check())

  restore()
})
