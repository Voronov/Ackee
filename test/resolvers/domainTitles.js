import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'
import listen from 'test-listen'

import * as users from '../../src/database/users.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

// The fixture does not remove the domains a test makes, so every test names its own
const unique = () => `${uuid()}.test`

const create = (token, title) =>
  api(
    base,
    {
      query: gql`
        mutation createDomain($input: CreateDomainInput!) {
          createDomain(input: $input) {
            success
            payload {
              id
              title
            }
          }
        }
      `,
      variables: { input: { title } },
    },
    token,
  )

const rename = (token, id, title) =>
  api(
    base,
    {
      query: gql`
        mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
          updateDomain(id: $id, input: $input) {
            success
            payload {
              title
            }
          }
        }
      `,
      variables: { id, input: { title } },
    },
    token,
  )

test.serial('a title is stored without the spaces around it', async (t) => {
  const title = unique()
  const { json } = await create(t.context.token.id, `  ${title}  `)

  t.is(json.data.createDomain.payload.title, title)
})

test.serial('a second domain with the same title is refused, whatever the case', async (t) => {
  const original = unique()
  t.is((await create(t.context.token.id, original)).json.data.createDomain.success, true)

  for (const title of [original, original.toUpperCase(), ` ${original} `]) {
    const { json } = await create(t.context.token.id, title)

    t.is(json.errors[0].message, 'A domain with this title already exists', title)
  }
})

test.serial('a domain is renamed to a free title, or to its own', async (t) => {
  const token = t.context.token.id
  const firstTitle = unique()
  const first = (await create(token, firstTitle)).json.data.createDomain.payload
  const second = (await create(token, unique())).json.data.createDomain.payload

  const taken = await rename(token, second.id, firstTitle.toUpperCase())
  t.is(taken.json.errors[0].message, 'A domain with this title already exists')

  // Saving a domain under the title it has is not a clash with itself
  t.is((await rename(token, first.id, firstTitle)).json.data.updateDomain.success, true)

  const free = unique()
  t.is((await rename(token, second.id, free)).json.data.updateDomain.payload.title, free)
})

test.serial('two workspaces may use the same title', async (t) => {
  const title = unique()
  await create(t.context.token.id, title)

  const { user } = await users.add({ email: `${uuid()}@example.com`, password: 'sufficiently-long' })
  const other = await Token.create({ userId: user.id })

  t.is((await create(other.id, title)).json.data.createDomain.success, true)
})
