import config from './config.js'
import { send } from './mailer.js'

// Links point at the public address of this instance, which the operator sets.
const link = (path, token) => `${(config.publicUrl ?? '').replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`

// Workspace titles and addresses come from users, so they must not become markup.
const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// Plain text alongside HTML: some clients show only the text part.
const layout = (title, body, action, url) => ({
  text: `${title}\n\n${body}\n\n${action}: ${url}\n\nIf you did not expect this email, you can ignore it.`,
  html: `<p>${escape(body)}</p><p><a href="${escape(url)}">${escape(action)}</a></p><p style="color:#666;font-size:13px">If you did not expect this email, you can ignore it.</p>`,
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

export const sendInvitation = (to, token, { workspaceTitle, invitedBy }) => {
  const url = link('/invitation', token)

  return send({
    to,
    subject: `You are invited to ${workspaceTitle} on Ackee`,
    ...layout(
      `You are invited to ${workspaceTitle} on Ackee`,
      `${invitedBy} invited you to the workspace "${workspaceTitle}". The link works once and expires in a week.`,
      'Accept invitation',
      url,
    ),
  })
}

// Sent when someone registers with an address that has an account. No one-time link: the
// owner has a password already, and the sign-in page offers a reset if it is forgotten.
export const sendAlreadyRegistered = (to) => {
  const url = `${(config.publicUrl ?? '').replace(/\/$/, '')}/`

  return send({
    to,
    subject: 'You already have an Ackee account',
    ...layout(
      'You already have an Ackee account',
      'Someone tried to create an account with this address, but it already has one. Sign in with your password, or ask for a new one on the sign-in page.',
      'Sign in',
      url,
    ),
  })
}
