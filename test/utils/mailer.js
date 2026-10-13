import test from 'ava'
import mockedEnv from 'mocked-env'

import { check, isEnabled, send, transportOptions } from '../../src/utils/mailer.js'
import signale from '../../src/utils/signale.js'

const email = { to: 'someone@example.com', subject: 'Test', text: 'Open https://example.com/verify?token=abc' }

// Serial: the transport is created once and reused, so the order of these tests matters.
test.serial('mail is off without an SMTP host', async (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: undefined })

  t.false(isEnabled())
  t.false(await send(email))
  t.false(await check())

  restore()
})

test.serial('during development an email goes to the log instead of being sent', async (t) => {
  const restore = mockedEnv({ NODE_ENV: 'development', ACKEE_SMTP_HOST: undefined })
  const info = signale.info
  const logged = []
  signale.info = (message) => logged.push(message)

  const sent = await send(email)

  signale.info = info
  restore()

  t.true(sent)
  t.is(logged.length, 1)
  t.true(logged[0].includes('someone@example.com'))
  t.true(logged[0].includes('https://example.com/verify?token=abc'))
})

// A failed email must not break the request that triggered it. A closed local port fails
// at once and needs no network.
test.serial('an unreachable SMTP server makes send return false instead of throwing', async (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: '127.0.0.1', ACKEE_SMTP_PORT: '465' })

  t.true(isEnabled())
  t.false(await send(email))
  t.false(await check())

  restore()
})

test('Mailbux: port 465 speaks TLS and logs in', (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: 'my.mailbux.com', ACKEE_SMTP_PORT: '465', ACKEE_SMTP_USER: 'ackee' })

  const options = transportOptions()

  restore()

  t.true(options.secure)
  t.false(options.requireTLS)
  t.is(options.auth.user, 'ackee')
})

test('Mailpit: port 1025 needs neither TLS nor a login', (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: 'localhost', ACKEE_SMTP_PORT: '1025', ACKEE_SMTP_USER: undefined })

  const options = transportOptions()

  restore()

  t.false(options.secure)
  t.false(options.requireTLS)
  t.is(options.auth, undefined)
})

test('port 587 refuses to send the password without STARTTLS', (t) => {
  const restore = mockedEnv({ ACKEE_SMTP_HOST: 'smtp.example.com', ACKEE_SMTP_PORT: '587' })

  t.true(transportOptions().requireTLS)

  restore()
})
