import test from 'ava'

import { ROLE_VIEWER } from '../../src/constants/roles.js'
import { DEFAULT_WORKSPACE_ID, SCHEMA_VERSION } from '../../src/constants/workspaces.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'

test('a domain belongs to the default workspace unless told otherwise', (t) => {
  t.is(new Domain({ title: 'Example' }).workspaceId, DEFAULT_WORKSPACE_ID)
  t.is(new Domain({ title: 'Example', workspaceId: 'other' }).workspaceId, 'other')
})

test('every new model records its schema version', (t) => {
  const documents = [
    new Domain({ title: 'Example' }),
    new User({ email: 'a@example.com' }),
    new Workspace({ title: 'Example' }),
    new Membership({ userId: 'user', workspaceId: 'workspace' }),
  ]

  for (const document of documents) t.is(document.schemaVersion, SCHEMA_VERSION)
})

test('a membership starts with the smallest role', (t) => {
  t.is(new Membership({ userId: 'user', workspaceId: 'workspace' }).role, ROLE_VIEWER)
})

test('a membership refuses an unknown role', async (t) => {
  const error = await new Membership({ userId: 'user', workspaceId: 'workspace', role: 'ROOT' })
    .validate()
    .catch((error_) => error_)

  t.not(error?.errors.role, undefined)
})

test('an email is stored in one form', (t) => {
  t.is(new User({ email: '  Admin@Example.COM ' }).email, 'admin@example.com')
})

test('a workspace needs a title', async (t) => {
  const error = await new Workspace({}).validate().catch((error_) => error_)

  t.not(error?.errors.title, undefined)
})
