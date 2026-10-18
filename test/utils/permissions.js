import test from 'ava'

import { DOMAINS_MANAGE, REPORTS_READ } from '../../src/constants/permissions.js'
import { can, workspacesWith } from '../../src/utils/permissions.js'

const viewer = {
  memberships: [
    { workspaceId: 'default', role: 'EDITOR', permissions: [REPORTS_READ, DOMAINS_MANAGE] },
    { workspaceId: 'agency', role: 'VIEWER', permissions: [REPORTS_READ] },
  ],
}

test('a permission counts only in the workspace that grants it', (t) => {
  t.true(can(viewer, DOMAINS_MANAGE))
  t.true(can(viewer, DOMAINS_MANAGE, 'default'))
  t.false(can(viewer, DOMAINS_MANAGE, 'agency'))
  t.false(can(viewer, REPORTS_READ, 'unknown'))
})

test('workspaces where a permission is held', (t) => {
  t.deepEqual(workspacesWith(viewer, REPORTS_READ), ['default', 'agency'])
  t.deepEqual(workspacesWith(viewer, DOMAINS_MANAGE), ['default'])
})
