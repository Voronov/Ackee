import express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { getClientIp } from 'request-ip'

import * as auditLog from './database/auditLog.js'
import * as invitations from './database/invitations.js'
import * as tokens from './database/tokens.js'
import * as userTokens from './database/userTokens.js'
import * as users from './database/users.js'
import * as workspaces from './database/workspaces.js'
import { verify as verifyPassword } from './utils/password.js'
import signale from './utils/signale.js'

/*
 * The pages that links in emails point at.
 *
 * They are plain server-rendered pages rather than part of the single-page interface.
 * A confirmation link has to work in any mail client, including one that opens it in a
 * stripped-down browser, so the fewer moving parts the better.
 */
const MINIMUM_PASSWORD_LENGTH = 10

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Ackee</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: Canvas; color: CanvasText;
}
main { width: min(420px, calc(100% - 32px)); padding: 32px 0; }
h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -.01em; }
p { margin: 0 0 16px; color: color-mix(in srgb, CanvasText 65%, Canvas); }
label { display: block; font-size: 14px; margin-bottom: 6px; }
input, button {
  font: inherit; width: 100%; box-sizing: border-box; border-radius: 10px;
  border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas); padding: 10px 12px;
  background: Canvas; color: CanvasText;
}
button { margin-top: 12px; cursor: pointer; border-color: color-mix(in srgb, CanvasText 40%, Canvas); }
a { color: inherit; }
</style>
</head>
<body><main>${body}</main></body>
</html>`

const message = (title, text) => page(title, `<h1>${title}</h1><p>${text}</p><p><a href="/">Go to Ackee</a></p>`)

// The same wording for every failure the user can do nothing about, and a clear one for
// the mistake they can: following a link twice.
// Workspace titles and addresses come from users, so they must not become markup.
const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const explain = (status, validity = 'a day') => {
  if (status === 'USED') return ['Link already used', 'This link works once. Ask for a new one if you still need it.']
  if (status === 'EXPIRED') return ['Link expired', `Links are valid for ${validity}. Ask for a new one.`]

  return ['Link not valid', 'Check that you copied the whole address from the email.']
}

const router = express.Router()

// A token cannot be guessed (256 bits), but every request still costs a database lookup.
// The address is read the same way as everywhere else, from the proxy headers.
// Only on the routes of this file: the router is mounted before /api and the static files.
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (request) => ipKeyGenerator(getClientIp(request) ?? ''),
  handler: (request, response) =>
    response.status(429).send(message('Too many requests', 'Wait a few minutes and open the link again.')),
})

router.get('/verify', linkLimiter, async (request, response) => {
  const result = await userTokens.redeem(String(request.query.token ?? ''), 'VERIFY')

  if (result.status !== 'OK') {
    const [title, text] = explain(result.status)

    return response.status(400).send(message(title, text))
  }

  await users.verify(result.userId)

  response.send(message('Address confirmed', 'Your account is ready. You can sign in now.'))
})

router.get('/reset', linkLimiter, (request, response) => {
  const token = String(request.query.token ?? '')

  // Tokens are base64url. Anything else is not a link we sent, and is never put on the page.
  if (/^[\w-]+$/.test(token) === false) {
    const [title, text] = explain('INVALID')

    return response.status(400).send(message(title, text))
  }

  response.send(
    page(
      'Choose a new password',
      `<h1>Choose a new password</h1>
       <p>At least ${MINIMUM_PASSWORD_LENGTH} characters. Length matters more than symbols.</p>
       <form method="post" action="/reset">
         <input type="hidden" name="token" value="${token}">
         <label for="password">New password</label>
         <input id="password" name="password" type="password" minlength="${MINIMUM_PASSWORD_LENGTH}" required autofocus>
         <button type="submit">Save</button>
       </form>`,
    ),
  )
})

router.post('/reset', linkLimiter, express.urlencoded({ extended: false }), async (request, response) => {
  const password = String(request.body.password ?? '')

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return response
      .status(400)
      .send(message('Password too short', `It needs at least ${MINIMUM_PASSWORD_LENGTH} characters.`))
  }

  const result = await userTokens.redeem(String(request.body.token ?? ''), 'RESET')

  if (result.status !== 'OK') {
    const [title, text] = explain(result.status)

    return response.status(400).send(message(title, text))
  }

  try {
    await users.setPassword(result.userId, password)
    // Whoever knew the old password must lose access too, the same as in `resetPassword`
    await tokens.delByUser(result.userId)
  } catch (error) {
    signale.fatal(error)

    return response.status(500).send(message('Something went wrong', 'Please try again in a moment.'))
  }

  response.send(message('Password changed', 'You can sign in with the new password now.'))
})

export default router

// Invitations (ACKEE-16). The link shows who is invited where, then asks for a password:
// a new one for an address without an account, the existing one otherwise. The link is
// used up only once the password is right, so a typo does not cost a new invitation.
const invitationForm = (invitation, workspaceTitle, existing) => {
  const ask = existing
    ? 'Enter the password of your account'
    : `Choose a password for your new account. At least ${MINIMUM_PASSWORD_LENGTH} characters.`

  return page(
    'Accept invitation',
    `<h1>Join ${escape(workspaceTitle)}</h1>
     <p>${ask} The invitation is for <b>${escape(invitation.email)}</b>.</p>
     <form method="post" action="/invitation">
       <input type="hidden" name="token" value="${escape(invitation.token)}">
       <label for="password">${existing ? 'Password' : 'New password'}</label>
       <input id="password" name="password" type="password" minlength="${existing ? 1 : MINIMUM_PASSWORD_LENGTH}" required autofocus>
       <button type="submit">Join</button>
     </form>`,
  )
}

const invitationTitle = async (invitation) => {
  const [workspace] = await workspaces.all([invitation.workspaceId])

  return workspace?.title ?? 'the workspace'
}

router.get('/invitation', linkLimiter, async (request, response) => {
  const token = String(request.query.token ?? '')

  if (/^[\w-]+$/.test(token) === false) {
    const [title, text] = explain('INVALID')

    return response.status(400).send(message(title, text))
  }

  const result = await invitations.peek(token)

  if (result.status !== 'OK') {
    const [title, text] = explain(result.status, 'a week')

    return response.status(400).send(message(title, text))
  }

  const existing = (await users.byEmail(result.invitation.email)) != null

  response.send(invitationForm({ ...result.invitation, token }, await invitationTitle(result.invitation), existing))
})

router.post('/invitation', linkLimiter, express.urlencoded({ extended: false }), async (request, response) => {
  const token = String(request.body.token ?? '')
  const password = String(request.body.password ?? '')

  const result = await invitations.peek(token)

  if (result.status !== 'OK') {
    const [title, text] = explain(result.status, 'a week')

    return response.status(400).send(message(title, text))
  }

  const { invitation } = result
  let account = await users.credentials(invitation.email)

  if (account != null) {
    // The env admin has no password and does not need invitations: the default workspace is theirs
    if (account.password == null || (await verifyPassword(password, account.password)) === false) {
      return response
        .status(400)
        .send(message('Wrong password', 'The password does not match the account with this address.'))
    }
  } else if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return response
      .status(400)
      .send(message('Password too short', `It needs at least ${MINIMUM_PASSWORD_LENGTH} characters.`))
  }

  const claimed = await invitations.redeem(token)

  if (claimed.status !== 'OK') {
    const [title, text] = explain(claimed.status, 'a week')

    return response.status(400).send(message(title, text))
  }

  try {
    if (account == null) {
      // The link proves the mailbox, as a confirmation link would
      account = (await users.add({ email: invitation.email, password })).user
      await users.verify(account.id)
    }

    await users.join(account.id, invitation.workspaceId, { role: invitation.role, domainIds: invitation.domainIds })
    await auditLog.record(
      { userId: account.id, email: account.email },
      invitation.workspaceId,
      'member.join',
      invitation.id,
    )
  } catch (error) {
    signale.fatal(error)

    return response.status(500).send(message('Something went wrong', 'Please try again in a moment.'))
  }

  response.send(
    message(
      'Invitation accepted',
      `You are now a member of ${escape(await invitationTitle(invitation))}. You can sign in now.`,
    ),
  )
})
