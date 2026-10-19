import crypto from 'node:crypto'
import http from 'node:http'

import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import AuditLog from '../../src/models/AuditLog.js'
import Membership from '../../src/models/Membership.js'
import Token from '../../src/models/Token.js'
import User from '../../src/models/User.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

const CLIENT_ID = 'client-id.apps.googleusercontent.com'

/*
 * A stand-in for Google's token endpoint. It checks PKCE the way Google does and answers with
 * an ID token whose claims each test chooses. The signature part is empty: Ackee does not read
 * it, because the token comes straight from the endpoint over TLS.
 */
const google = { claims: {}, challenges: new Map(), requests: [] }

const fakeGoogle = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const form = new URLSearchParams(body)
    google.requests.push(form)

    const challenge = google.challenges.get(form.get('code'))
    const verifier = crypto
      .createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url')

    if (challenge == null || challenge.value !== verifier || form.get('client_secret') !== 'client-secret') {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify({ error: 'invalid_grant' }))
    }

    const claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: challenge.nonce,
      email_verified: true,
      ...google.claims,
    }
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ id_token: `${encode({ alg: 'RS256' })}.${encode(claims)}.` }))
  })
})

let restoreEnv

test.before(async () => {
  const tokenUrl = await listen(fakeGoogle)

  restoreEnv = mockedEnv({
    ACKEE_GOOGLE_CLIENT_ID: CLIENT_ID,
    ACKEE_GOOGLE_CLIENT_SECRET: 'client-secret',
    ACKEE_GOOGLE_TOKEN_URL: tokenUrl,
    ACKEE_URL: 'https://ackee.example.com',
    ACKEE_ALLOW_SIGNUP: 'true',
  })
})

test.after.always(() => {
  restoreEnv()
  fakeGoogle.close()
})

// Each request from its own address, so the rate limit of the routes stays out of the way
let address = 0
const get = async (path, cookie, from = `198.51.100.${++address % 250}`) =>
  fetch(new URL(path, await base).href, {
    redirect: 'manual',
    headers: { 'X-Forwarded-For': from, ...(cookie == null ? {} : { Cookie: cookie }) },
  })

// Starts a sign-in like the button does, and plays Google's part up to the redirect back
const start = async () => {
  const response = await get('/auth/google')
  const location = new URL(response.headers.get('location'))
  const cookie = response.headers.get('set-cookie').split(';')[0]
  const code = crypto.randomBytes(8).toString('hex')

  google.challenges.set(code, {
    value: location.searchParams.get('code_challenge'),
    nonce: location.searchParams.get('nonce'),
  })

  return { response, location, cookie, code, state: location.searchParams.get('state') }
}

const signIn = async (claims) => {
  google.claims = claims
  const { cookie, code, state } = await start()
  const response = await get(`/auth/google/callback?code=${code}&state=${state}`, cookie)

  return { status: response.status, body: await response.text() }
}

const handedToken = (body) => body.match(/"\\"([\da-f-]{36})\\""/)?.[1]

test.serial('the button goes to Google with PKCE, a nonce and a state bound to the browser', async (t) => {
  const { response, location, cookie } = await start()

  t.is(response.status, 302)
  t.is(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  t.is(location.searchParams.get('client_id'), CLIENT_ID)
  t.is(location.searchParams.get('redirect_uri'), 'https://ackee.example.com/auth/google/callback')
  t.is(location.searchParams.get('code_challenge_method'), 'S256')
  t.is(location.searchParams.get('scope'), 'openid email')
  t.truthy(location.searchParams.get('nonce'))
  t.is(cookie, `ackee_google_state=${location.searchParams.get('state')}`)
  t.regex(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Secure/)
})

test.serial('a new person signs in with Google and gets an account with a workspace', async (t) => {
  const { status, body } = await signIn({ sub: 'google-1', email: 'New@Example.com' })

  t.is(status, 200)
  const user = await User.findOne({ email: 'new@example.com' }).lean()
  t.true(user.verified)
  t.is(user.googleId, 'google-1')
  t.is(user.password, undefined)
  t.is((await Membership.find({ userId: user.id }).lean())[0].role, 'OWNER')

  // The session reaches the interface through the page, not the address bar
  const token = handedToken(body)
  t.truthy(await Token.findOne({ id: token, userId: user.id }))
  t.regex(body, /localStorage\.setItem\("ackee_token_/)
  t.is(await AuditLog.countDocuments({ userId: user.id, action: 'user.signIn.google' }), 1)

  // The token works like one from the password form
  const { json } = await api(
    base,
    {
      query: gql`
        {
          viewer {
            email
          }
        }
      `,
    },
    token,
  )
  t.is(json.data.viewer.email, 'new@example.com')
})

test.serial('signing in again finds the same account by its Google id', async (t) => {
  await signIn({ sub: 'google-2', email: 'again@example.com' })
  const { status } = await signIn({ sub: 'google-2', email: 'renamed@example.com' })

  t.is(status, 200)
  t.is(await User.countDocuments({ googleId: 'google-2' }), 1)
})

test.serial('an existing account is linked and confirmed by Google', async (t) => {
  const { user } = await users.add({ email: 'existing@example.com', password: 'sufficiently-long' })

  const { status } = await signIn({ sub: 'google-3', email: 'existing@example.com' })

  t.is(status, 200)
  const linked = await User.findOne({ id: user.id }).lean()
  t.is(linked.googleId, 'google-3')
  t.true(linked.verified)
})

test.serial('an address Google has not confirmed is refused', async (t) => {
  const { status, body } = await signIn({ sub: 'google-4', email: 'unconfirmed@example.com', email_verified: false })

  t.is(status, 400)
  t.regex(body, /not confirmed/i)
  t.is(await User.countDocuments({ email: 'unconfirmed@example.com' }), 0)
})

test.serial('an address linked to another Google account is refused', async (t) => {
  await signIn({ sub: 'google-5', email: 'taken@example.com' })
  const { status, body } = await signIn({ sub: 'google-6', email: 'taken@example.com' })

  t.is(status, 400)
  t.regex(body, /another Google account/i)
})

test.serial('claims for another app, from another issuer, expired or with another nonce are refused', async (t) => {
  t.regex((await signIn({ sub: 'g-7', email: 'a7@example.com', aud: 'someone-else' })).body, /another app/i)
  t.regex(
    (await signIn({ sub: 'g-7', email: 'a7@example.com', iss: 'https://evil.example.com' })).body,
    /not come from Google/i,
  )
  t.regex((await signIn({ sub: 'g-7', email: 'a7@example.com', exp: 1 })).body, /expired/i)
  t.regex((await signIn({ sub: 'g-7', email: 'a7@example.com', nonce: 'other' })).body, /does not belong/i)
  t.is(await User.countDocuments({ email: 'a7@example.com' }), 0)
})

test.serial('the state works once and only in the browser that started the sign-in', async (t) => {
  google.claims = { sub: 'google-8', email: 'state@example.com' }
  const { cookie, code, state } = await start()

  t.is((await get(`/auth/google/callback?code=${code}&state=${state}`)).status, 400)
  t.is((await get(`/auth/google/callback?code=${code}&state=${state}`, 'ackee_google_state=other')).status, 400)

  t.is((await get(`/auth/google/callback?code=${code}&state=${state}`, cookie)).status, 200)
  t.is((await get(`/auth/google/callback?code=${code}&state=${state}`, cookie)).status, 400)
})

test.serial('without an account and with registration closed, nobody is created', async (t) => {
  const restore = mockedEnv({ ACKEE_ALLOW_SIGNUP: undefined })
  const { status, body } = await signIn({ sub: 'google-9', email: 'closed@example.com' })
  restore()

  t.is(status, 400)
  t.regex(body, /registration is closed/i)
  t.is(await User.countDocuments({ email: 'closed@example.com' }), 0)
})

test.serial('a refusal from Google or a broken answer signs nobody in', async (t) => {
  const { cookie, state } = await start()
  t.regex(await (await get(`/auth/google/callback?error=access_denied&state=${state}`, cookie)).text(), /cancelled/i)

  // A code Google does not know: the token endpoint answers 400
  const next = await start()
  const response = await get(`/auth/google/callback?code=unknown&state=${next.state}`, next.cookie)
  t.is(response.status, 502)
})

const signInOptions = async () => {
  const { json } = await api(base, {
    query: gql`
      {
        signInOptions {
          google
        }
      }
    `,
  })
  return json.data.signInOptions.google
}

test.serial('without the settings the button and the routes are gone', async (t) => {
  t.true(await signInOptions())

  const restore = mockedEnv({ ACKEE_GOOGLE_CLIENT_ID: undefined })
  t.false(await signInOptions())
  t.is((await get('/auth/google')).status, 404)
  t.is((await get('/auth/google/callback?code=x&state=y')).status, 404)
  restore()
})

test.serial('one address cannot start sign-ins without end', async (t) => {
  const statuses = []
  for (let index = 0; index < 31; index++) statuses.push((await get('/auth/google', undefined, '203.0.113.9')).status)

  t.is(statuses.filter((status) => status === 302).length, 30)
  t.is(statuses.at(-1), 429)
})
