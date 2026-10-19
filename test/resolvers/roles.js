import test from 'ava'
import listen from 'test-listen'

import { ROLE_EDITOR, ROLE_VIEWER } from '../../src/constants/roles.js'
import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import Token from '../../src/models/Token.js'
import server from '../../src/server.js'
import { api } from '../_utils.js'
import { cleanup, connectToDatabase, gql } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))

// An agency workspace with a client who may only look and a colleague who may edit.
const member = async (name, workspaceId, role) => {
  const { user } = await users.add({
    email: `${name}@roles.example.com`,
    password: 'sufficiently-long',
    verified: true,
  })

  await Membership.create({ userId: user.id, workspaceId, role })

  return Token.create({ userId: user.id })
}

let agency
let client
let colleague

test.before(async () => {
  const owner = await users.add({
    email: 'owner@roles.example.com',
    password: 'sufficiently-long',
    verified: true,
    workspaceTitle: 'Agency',
  })

  agency = await Domain.create({ title: 'client.example.com', workspaceId: owner.workspace.id })
  client = await member('client', owner.workspace.id, ROLE_VIEWER)
  colleague = await member('colleague', owner.workspace.id, ROLE_EDITOR)
})

const fetchDomain = (token) =>
  api(
    base,
    {
      query: gql`
        query fetchDomain($id: ID!) {
          domain(id: $id) {
            id
          }
        }
      `,
      variables: { id: agency.id },
    },
    token.id,
  )

const renameDomain = (token, title) =>
  api(
    base,
    {
      query: gql`
        mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
          updateDomain(id: $id, input: $input) {
            success
          }
        }
      `,
      variables: { id: agency.id, input: { title } },
    },
    token.id,
  )

test.serial('a viewer can read the domains of their workspace', async (t) => {
  const { json } = await fetchDomain(client)

  t.is(json.data.domain.id, agency.id)
})

test.serial('a viewer cannot change or delete them', async (t) => {
  const update = await renameDomain(client, 'renamed-by-client.example.com')

  t.truthy(update.json.errors)

  const remove = await api(
    base,
    {
      query: gql`
        mutation deleteDomain($id: ID!) {
          deleteDomain(id: $id) {
            success
          }
        }
      `,
      variables: { id: agency.id },
    },
    client.id,
  )

  t.truthy(remove.json.errors)
  t.is((await Domain.findOne({ id: agency.id })).title, 'client.example.com')
})

test.serial('an editor can change them', async (t) => {
  const { json } = await renameDomain(colleague, 'renamed.example.com')

  t.true(json.data.updateDomain.success)
  t.is((await Domain.findOne({ id: agency.id })).title, 'renamed.example.com')
})
