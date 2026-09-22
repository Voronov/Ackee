import test from 'ava'
import listen from 'test-listen'
import mockedEnv from 'mocked-env'

import GaConnection from '../../src/models/GaConnection.js'
import server from '../../src/server.js'
import { decrypt } from '../../src/utils/secrets.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(async (t) => {
  await GaConnection.deleteMany({})
  await cleanupDatabase(t)
})

const connect = (t, credentials, propertyId = '123456789') =>
  api(
    base,
    {
      query: gql`
        mutation createGaConnection($input: CreateGaConnectionInput!) {
          createGaConnection(input: $input) {
            success
          }
        }
      `,
      variables: { input: { domainId: t.context.domain.id, propertyId, credentials } },
    },
    t.context.token.id,
  )

const KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'example',
  client_email: 'ackee@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----\n',
})

test.serial('without ACKEE_SECRET nothing is stored', async (t) => {
  const restore = mockedEnv({ ACKEE_SECRET: undefined })

  const { json } = await connect(t, KEY)

  // A service account key opens the user's Google account. Storing it unencrypted because
  // the instance forgot to set a secret would be worse than refusing.
  t.regex(json.errors[0].message, /ACKEE_SECRET/i)
  t.is(await GaConnection.countDocuments(), 0)

  restore()
})

test.serial('the wrong file is refused before Analytics is called', async (t) => {
  const restore = mockedEnv({ ACKEE_SECRET: 'test-secret' })

  const notJson = await connect(t, 'not json at all')
  t.regex(notJson.json.errors[0].message, /valid JSON/i)

  const wrongShape = await connect(t, JSON.stringify({ hello: 'world' }))
  t.regex(wrongShape.json.errors[0].message, /client_email/i)

  t.is(await GaConnection.countDocuments(), 0)

  restore()
})

test.serial('a key Analytics refuses is not stored', async (t) => {
  const restore = mockedEnv({ ACKEE_SECRET: 'test-secret' })

  // The key above is syntactically right but meaningless, so the check against the
  // property fails. That failure has to happen now, not silently at four in the morning.
  const { json } = await connect(t, KEY)

  t.truthy(json.errors)
  t.regex(json.errors[0].message, /Analytics refused/i)
  t.is(await GaConnection.countDocuments(), 0)

  restore()
})

test.serial('a stored key is encrypted and never returned', async (t) => {
  const restore = mockedEnv({ ACKEE_SECRET: 'test-secret' })

  // Stored directly, because reaching this state through the API needs a real Google
  // account. What matters here is what the database holds and what the API gives back.
  const { encrypt } = await import('../../src/utils/secrets.js')

  await GaConnection.create({
    workspaceId: t.context.workspace.id,
    domainId: t.context.domain.id,
    propertyId: '123456789',
    serviceAccountEmail: 'ackee@example.iam.gserviceaccount.com',
    credentials: encrypt(KEY),
  })

  const stored = await GaConnection.findOne({ domainId: t.context.domain.id }).lean()

  t.false(stored.credentials.includes('private_key'))
  t.is(decrypt(stored.credentials), KEY)

  const { json } = await api(
    base,
    {
      query: gql`
        query gaConnection($domainId: ID!) {
          gaConnection(domainId: $domainId) {
            propertyId
            serviceAccountEmail
          }
        }
      `,
      variables: { domainId: t.context.domain.id },
    },
    t.context.token.id,
  )

  // The address is shown so the owner can tell which account they connected. The key is
  // not part of the schema at all, so it cannot be asked for.
  t.is(json.data.gaConnection.serviceAccountEmail, 'ackee@example.iam.gserviceaccount.com')
  t.is(json.data.gaConnection.propertyId, '123456789')

  restore()
})
