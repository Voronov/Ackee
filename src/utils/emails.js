import config from './config.js'
import { send } from './mailer.js'

// Links point at the public address of this instance, which the operator sets. A wrong
// value here produces links that go nowhere, so it is worth getting right.
const link = (path, token) => `${(config.publicUrl ?? '').replace(/\/$/, '')}${path}?token=${token}`

// Plain text alongside HTML: some clients show only the text part, and a confirmation
// link that arrives unreadable is the same as one that never arrived.
const layout = (title, body, action, url) => ({
  text: `${title}\n\n${body}\n\n${action}: ${url}\n\nIf you did not expect this email, you can ignore it.`,
  html: `<p>${body}</p><p><a href="${url}">${action}</a></p><p style="color:#666;font-size:13px">If you did not expect this email, you can ignore it.</p>`,
})

export const sendVerification = (to, token) => {
  const url = link('/verify', token)

  return send({
    to,
    subject: 'Confirm your Ackee account',
    ...layout(
      'Confirm your Ackee account',
      'Your account is ready as soon as you confirm this address. The link works once and expires in a day.',
      'Confirm address',
      url,
    ),
  })
}

export const sendPasswordReset = (to, token) => {
  const url = link('/reset', token)

  return send({
    to,
    subject: 'Reset your Ackee password',
    ...layout(
      'Reset your Ackee password',
      'Someone asked to reset the password for this address. The link works once and expires in a day.',
      'Choose a new password',
      url,
    ),
  })
}
