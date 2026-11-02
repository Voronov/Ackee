import test from 'ava'
import mockedEnv from 'mocked-env'

import { sendAlreadyRegistered, sendInvitation, sendPasswordReset, sendVerification } from '../../src/utils/emails.js'
import signale from '../../src/utils/signale.js'

// In development mode the mailer logs the text part, which is enough to read what was sent.
const capture = async (sendEmail) => {
  const restore = mockedEnv({ NODE_ENV: 'development', ACKEE_URL: 'https://ackee.example.com/' })
  const info = signale.info
  const logged = []
  signale.info = (message) => logged.push(message)

  await sendEmail()

  signale.info = info
  restore()

  return logged.join('\n')
}

test.serial('the confirmation email links to /verify on the public address', async (t) => {
  const text = await capture(() => sendVerification('new@example.com', 'abc'))

  t.true(text.includes('new@example.com'))
  t.true(text.includes('https://ackee.example.com/verify?token=abc'))
})

test.serial('the password reset email links to /reset', async (t) => {
  const text = await capture(() => sendPasswordReset('user@example.com', 'abc'))

  t.true(text.includes('Reset your Ackee password'))
  t.true(text.includes('https://ackee.example.com/reset?token=abc'))
})

test.serial('the invitation email names the workspace and who invited', async (t) => {
  const text = await capture(() =>
    sendInvitation('guest@example.com', 'abc', { workspaceTitle: 'Agency', invitedBy: 'owner@example.com' }),
  )

  t.true(text.includes('owner@example.com invited you to the workspace "Agency"'))
  t.true(text.includes('https://ackee.example.com/invitation?token=abc'))
})

test.serial('the note about a taken address links to the sign-in page, without a token', async (t) => {
  const text = await capture(() => sendAlreadyRegistered('owner@example.com'))

  t.true(text.includes('You already have an Ackee account'))
  t.true(text.includes('Sign in: https://ackee.example.com/'))
  t.false(text.includes('token='))
})

test.serial('a token cannot change the link', async (t) => {
  const text = await capture(() => sendVerification('new@example.com', 'a&next=https://evil.example'))

  t.true(text.includes('token=a%26next%3Dhttps%3A%2F%2Fevil.example'))
})
