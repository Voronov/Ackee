import crypto from 'node:crypto'
import { createRequire } from 'node:module'

import express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { getClientIp } from 'request-ip'

import { ROLE_OWNER } from './constants/roles.js'
import * as auditLog from './database/auditLog.js'
import * as tokens from './database/tokens.js'
import * as users from './database/users.js'
import OAuthState from './models/OAuthState.js'
import config from './utils/config.js'
import { on as ignoreCookieOn } from './utils/ignoreCookie.js'
import signale from './utils/signale.js'

/*
 * Sign-in with Google (ACKEE-79): OpenID Connect, authorization code with PKCE.
 *
 * The ID token comes straight from Google's token endpoint over TLS, so OpenID Connect Core
 * 3.1.3.7 lets the client skip its signature. Its claims are still checked: issuer, audience,
 * expiry, nonce and a confirmed address.
 */
// The interface keeps its session under a key with the version, see ui/scripts/hooks/useToken.js
const { version } = createRequire(import.meta.url)('../package.json')

const STATE_COOKIE = 'ackee_google_state'
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

export const isEnabled = () =>
  Boolean(config.googleClientId) && Boolean(config.googleClientSecret) && Boolean(config.publicUrl)

const base64url = (buffer) => buffer.toString('base64url')
const random = () => base64url(crypto.randomBytes(32))
const digest = (value) => crypto.createHash('sha256').update(value).digest()

const redirectUri = () => `${config.publicUrl.replace(/\/$/, '')}/auth/google/callback`

const stateCookie = (value, maxAge) => {
  const secure = config.publicUrl.startsWith('https:') ? '; Secure' : ''
  // Lax: Google sends the browser back with a top-level GET, which Lax allows
  return `${STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/auth/google; HttpOnly; SameSite=Lax${secure}`
}

const cookieOf = (request, name) =>
  (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1]

const escape = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const page = (title, text) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Ackee</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}main{width:min(420px,calc(100% - 32px))}</style>
</head><body><main><h1>${escape(title)}</h1><p>${escape(text)}</p><p><a href="/">Go to Ackee</a></p></main></body></html>`

// Hands the session to the interface the same way the sign-in form does: through localStorage,
// never through the address bar, where it would end up in the history and in logs.
const handOver = (token) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signing in · Ackee</title></head><body>
<script>localStorage.setItem(${JSON.stringify(`ackee_token_${version}`)}, ${JSON.stringify(JSON.stringify(token))}); location.replace('/')</script>
<noscript>Ackee needs JavaScript.</noscript>
</body></html>`

const claimsOf = (idToken) => {
  const [, payload] = String(idToken ?? '').split('.')
  if (payload == null) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// Why a sign-in was refused, or null when the claims are fine
const refusal = (claims, nonce) => {
  if (claims == null) return 'Google sent an answer Ackee cannot read.'
  if (ISSUERS.has(claims.iss) === false) return 'The answer did not come from Google.'

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (audience.includes(config.googleClientId) === false) return 'The answer was meant for another app.'
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return 'The answer from Google has expired.'
  if (claims.nonce !== nonce) return 'The answer does not belong to this sign-in.'
  if (claims.email_verified !== true || typeof claims.email !== 'string') {
    return 'Google has not confirmed this email address, so Ackee cannot use it.'
  }

  return null
}

const exchange = async (code, codeVerifier) => {
  const response = await fetch(config.googleTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })

  if (response.ok === false) throw new Error(`Google token endpoint answered ${response.status}`)

  return (await response.json()).id_token
}

// The account for these claims: linked before, found by address, or new. A string is a refusal.
const accountFor = async ({ sub, email }) => {
  const linked = await users.byGoogleId(sub)
  if (linked != null) return linked

  const existing = await users.withGoogleId(email)

  if (existing != null) {
    // The address belongs to an account linked to another Google account
    if (existing.googleId != null && existing.googleId !== sub)
      return 'This email address is linked to another Google account.'

    return users.linkGoogle(existing.id, sub)
  }

  if (config.allowSignup !== true) return 'There is no account with this address, and registration is closed.'

  return (await users.addFromGoogle({ email: email.toLowerCase(), googleId: sub })).user
}

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: (request) => ipKeyGenerator(getClientIp(request) ?? ''),
  handler: (request, response) =>
    response.status(429).send(page('Too many requests', 'Wait a few minutes and try again.')),
})

// Without the settings the routes do not exist, as if the feature were not there at all
router.use('/auth/google', (request, response, next) => (isEnabled() ? next() : response.status(404).send('Not found')))

router.get('/auth/google', limiter, async (request, response) => {
  const state = random()
  const codeVerifier = random()
  const nonce = random()

  await OAuthState.create({ hash: base64url(digest(state)), codeVerifier, nonce })

  const url = new URL(config.googleAuthUrl)
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: base64url(digest(codeVerifier)),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()

  response.setHeader('Set-Cookie', stateCookie(state, 600))
  response.redirect(302, url.href)
})

router.get('/auth/google/callback', limiter, async (request, response) => {
  const state = String(request.query.state ?? '')

  // The state is spent whatever happens next
  response.setHeader('Set-Cookie', stateCookie('', 0))

  if (request.query.error != null)
    return response.status(400).send(page('Sign-in cancelled', 'Google did not sign you in.'))

  // Bound to this browser: a link with someone else's state does not sign anyone in here
  if (state === '' || cookieOf(request, STATE_COOKIE) !== state) {
    return response.status(400).send(page('Sign-in expired', 'Start the sign-in with Google again.'))
  }

  const entry = await OAuthState.findOneAndUpdate(
    { hash: base64url(digest(state)), used: false, expires: { $gt: new Date() } },
    { $set: { used: true } },
    { returnDocument: 'after' },
  )

  if (entry == null) return response.status(400).send(page('Sign-in expired', 'Start the sign-in with Google again.'))

  let claims

  try {
    claims = claimsOf(await exchange(String(request.query.code ?? ''), entry.codeVerifier))
  } catch (error) {
    signale.warn(`Sign-in with Google failed: ${error.message}`)

    return response.status(502).send(page('Google did not answer', 'Try again in a moment.'))
  }

  const refused = refusal(claims, entry.nonce)
  if (refused != null) return response.status(400).send(page('Sign-in refused', refused))

  const account = await accountFor(claims)
  if (typeof account === 'string') return response.status(400).send(page('Sign-in refused', account))

  const token = await tokens.add(account.id)

  for (const membership of await users.memberships(account.id)) {
    if (membership.role === ROLE_OWNER) {
      await auditLog.record(
        { userId: account.id, email: account.email },
        membership.workspaceId,
        'user.signIn.google',
        account.id,
      )
    }
  }

  // The same as signing in with a password: your own visits are not counted
  response.append(
    'Set-Cookie',
    `${ignoreCookieOn.name}=${ignoreCookieOn.value}; Max-Age=${ignoreCookieOn.options.maxAge}; Path=/; SameSite=None; Secure`,
  )
  response.send(handOver(token.id))
})

export default router
