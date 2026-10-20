import test from 'ava'
import mockedEnv from 'mocked-env'
import listen from 'test-listen'

import * as userTokens from '../../src/database/userTokens.js'
import * as users from '../../src/database/users.js'
import AuditLog from '../../src/models/AuditLog.js'
import Passkey from '../../src/models/Passkey.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import SoftAuthenticator from '../_softAuthenticator.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)
const ORIGIN = 'https://ackee.example.com'

test.before(connectToDatabase)
test.after.always(cleanup(server))

let restoreEnv
test.before(() => {
  restoreEnv = mockedEnv({ ACKEE_URL: ORIGIN })
})
test.after.always(() => restoreEnv())

const account = async (email) => {
  const { user } = await users.add({ email, password: 'sufficiently-long' })
  await users.verify(user.id)
  const token = await Token.create({ userId: user.id })

  return { user, call: (query, variables) => api(base, { query, variables }, token.id) }
}

const anonymous = (query, variables) => api(base, { query, variables })

const registrationOptions = async (call) => {
  const { json } = await call(gql`
    mutation {
      passkeyRegistrationOptions
    }
  `)
  return JSON.parse(json.data.passkeyRegistrationOptions)
}

const addPasskey = (call, name, answer) =>
  call(
    gql`
      mutation addPasskey($input: AddPasskeyInput!) {
        addPasskey(input: $input) {
          success
          payload {
            id
            name
          }
        }
      }
    `,
    { input: { name, response: JSON.stringify(answer) } },
  )

const signInOptions = async () => {
  const { json } = await anonymous(gql`
    mutation {
      passkeySignInOptions
    }
  `)
  return JSON.parse(json.data.passkeySignInOptions)
}

const signIn = (answer) =>
  anonymous(
    gql`
      mutation createTokenWithPasskey($response: String!) {
        createTokenWithPasskey(response: $response) {
          payload {
            id
          }
        }
      }
    `,
    { response: JSON.stringify(answer) },
  )

// A user with one passkey on a fresh authenticator
const withPasskey = async (email) => {
  const owner = await account(email)
  const authenticator = new SoftAuthenticator(ORIGIN)
  const { json } = await addPasskey(
    owner.call,
    'MacBook',
    authenticator.register(await registrationOptions(owner.call)),
  )

  return { ...owner, authenticator, passkey: json.data.addPasskey.payload }
}

test('a signed-in user adds a passkey and signs in with it, without a password', async (t) => {
  const { user, authenticator, passkey } = await withPasskey('passkey-1@example.com')
  t.is(passkey.name, 'MacBook')

  const options = await signInOptions()
  // Discoverable: the server does not need to know who is signing in
  t.deepEqual(options.allowCredentials ?? [], [])
  t.is(options.rpId, 'ackee.example.com')

  const { json } = await signIn(authenticator.authenticate(options))
  const token = json.data.createTokenWithPasskey.payload.id

  const { json: viewer } = await api(
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
  t.is(viewer.data.viewer.email, 'passkey-1@example.com')

  const stored = await Passkey.findOne({ id: passkey.id }).lean()
  t.is(stored.counter, 1)
  t.truthy(stored.lastUsed)
  t.is(await AuditLog.countDocuments({ userId: user.id, action: 'user.signIn.passkey' }), 1)
  t.is(await AuditLog.countDocuments({ userId: user.id, action: 'passkey.add' }), 1)
})

test('a challenge works once', async (t) => {
  const { authenticator } = await withPasskey('passkey-2@example.com')
  const options = await signInOptions()

  t.truthy((await signIn(authenticator.authenticate(options))).json.data)
  t.regex((await signIn(authenticator.authenticate(options))).json.errors[0].message, /not accepted/i)
})

test('a registration challenge belongs to the user who asked for it', async (t) => {
  const first = await account('passkey-3a@example.com')
  const second = await account('passkey-3b@example.com')
  const options = await registrationOptions(first.call)

  const { json } = await addPasskey(second.call, 'Stolen', new SoftAuthenticator(ORIGIN).register(options))
  t.regex(json.errors[0].message, /could not be added/i)
})

test('an answer made for another site is refused', async (t) => {
  const { authenticator } = await withPasskey('passkey-4@example.com')

  const { json } = await signIn(
    authenticator.authenticate(await signInOptions(), { origin: 'https://phishing.example.net' }),
  )
  t.regex(json.errors[0].message, /not accepted/i)

  const owner = await account('passkey-4b@example.com')
  const added = await addPasskey(
    owner.call,
    'Elsewhere',
    new SoftAuthenticator(ORIGIN).register(await registrationOptions(owner.call), {
      origin: 'https://phishing.example.net',
    }),
  )
  t.regex(added.json.errors[0].message, /could not be added/i)
})

test('a signature counter that goes back means a cloned key and is refused', async (t) => {
  const { authenticator } = await withPasskey('passkey-5@example.com')

  t.truthy((await signIn(authenticator.authenticate(await signInOptions(), { counter: 5 }))).json.data)
  t.regex(
    (await signIn(authenticator.authenticate(await signInOptions(), { counter: 3 }))).json.errors[0].message,
    /not accepted/i,
  )
})

test('a deleted passkey no longer signs in, and only its owner can delete it', async (t) => {
  const { call, authenticator, passkey } = await withPasskey('passkey-6@example.com')
  const stranger = await account('passkey-6b@example.com')
  const remove = (caller) =>
    caller(
      gql`
        mutation deletePasskey($id: ID!) {
          deletePasskey(id: $id) {
            success
          }
        }
      `,
      { id: passkey.id },
    )

  t.regex((await remove(stranger.call)).json.errors[0].message, /unknown passkey/i)
  t.true((await remove(call)).json.data.deletePasskey.success)

  t.regex((await signIn(authenticator.authenticate(await signInOptions()))).json.errors[0].message, /not known/i)
})

test('several passkeys per account, each listed by name; the same one twice is refused', async (t) => {
  const { call, authenticator } = await withPasskey('passkey-7@example.com')
  await addPasskey(call, 'YubiKey', new SoftAuthenticator(ORIGIN).register(await registrationOptions(call)))

  const { json } = await call(gql`
    query {
      passkeys {
        name
      }
    }
  `)
  t.deepEqual(
    json.data.passkeys.map((passkey) => passkey.name),
    ['MacBook', 'YubiKey'],
  )

  // The same authenticator again: the options exclude it, and the server refuses it anyway
  const options = await registrationOptions(call)
  t.is(options.excludeCredentials.length, 2)
  t.regex((await addPasskey(call, 'Again', authenticator.register(options))).json.errors[0].message, /already added/i)
})

test('adding a passkey needs a token and a name', async (t) => {
  const { json } = await anonymous(gql`
    mutation {
      passkeyRegistrationOptions
    }
  `)
  t.regex(json.errors[0].message, /token missing/i)

  const owner = await account('passkey-8@example.com')
  const answer = new SoftAuthenticator(ORIGIN).register(await registrationOptions(owner.call))
  t.regex((await addPasskey(owner.call, '  ', answer)).json.errors[0].message, /name/i)
  const { json: broken } = await anonymous(
    gql`
      mutation createTokenWithPasskey($response: String!) {
        createTokenWithPasskey(response: $response) {
          success
        }
      }
    `,
    { response: '{not json' },
  )
  t.regex(broken.errors[0].message, /could not be read/i)
})

test.serial('without ACKEE_URL passkeys are off', async (t) => {
  const restore = mockedEnv({ ACKEE_URL: undefined })

  const { json } = await anonymous(gql`
    {
      signInOptions {
        passkey
      }
    }
  `)
  t.false(json.data.signInOptions.passkey)

  const { json: options } = await anonymous(gql`
    mutation {
      passkeySignInOptions
    }
  `)
  t.regex(options.errors[0].message, /ACKEE_URL/)

  restore()
})

// Review of #32: an intruder who added a passkey must not keep it after the owner resets the password
test('a password reset removes every passkey', async (t) => {
  const { user, authenticator } = await withPasskey('passkey-9@example.com')
  const token = await userTokens.issue(user.id, 'RESET')

  const { json } = await anonymous(
    gql`
      mutation resetPassword($input: ResetPasswordInput!) {
        resetPassword(input: $input) {
          success
        }
      }
    `,
    { input: { token, password: 'a-new-long-password' } },
  )
  t.true(json.data.resetPassword.success)

  t.is(await Passkey.countDocuments({ userId: user.id }), 0)
  t.regex((await signIn(authenticator.authenticate(await signInOptions()))).json.errors[0].message, /not known/i)
})
