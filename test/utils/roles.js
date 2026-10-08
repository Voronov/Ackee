import test from 'ava'

import { ROLE_EDITOR, ROLE_OWNER, ROLE_VIEWER, isAtLeast } from '../../src/constants/roles.js'
import { canEdit, canOwn, workspaceIds } from '../../src/utils/domainIds.js'

test('roles are ranked viewer, editor, owner', (t) => {
  t.true(isAtLeast(ROLE_OWNER, ROLE_EDITOR))
  t.true(isAtLeast(ROLE_EDITOR, ROLE_EDITOR))
  t.false(isAtLeast(ROLE_VIEWER, ROLE_EDITOR))
  t.false(isAtLeast(ROLE_EDITOR, ROLE_OWNER))
})

// An unknown role must never rank above a known one.
test('an unknown role is below every known role', (t) => {
  t.false(isAtLeast('ADMIN', ROLE_VIEWER))
})

const viewer = {
  memberships: [
    { workspaceId: 'agency', role: ROLE_OWNER },
    { workspaceId: 'client-a', role: ROLE_EDITOR },
    { workspaceId: 'client-b', role: ROLE_VIEWER },
  ],
}

test('a viewer can read every workspace they belong to', (t) => {
  t.deepEqual(workspaceIds(viewer), ['agency', 'client-a', 'client-b'])
})

test('editing needs at least the editor role', (t) => {
  t.deepEqual(canEdit(viewer), ['agency', 'client-a'])
})

test('owning needs the owner role', (t) => {
  t.deepEqual(canOwn(viewer), ['agency'])
})
