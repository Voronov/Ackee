// Makes the stand's v1.0 data usable by this branch: a user, a workspace that owns the
// stand's domain, and the indexes of the collections this branch adds. Idempotent.
//
//   ACKEE_MONGODB=… node tools/spike-15/setup-stand.js [--email …] [--password …] [--domain …]
import { parseArgs } from 'node:util'

import * as users from '../../src/database/users.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import Rollup from '../../src/models/Rollup.js'
import RollupState from '../../src/models/RollupState.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
import signale from '../../src/utils/signale.js'
import { connectStand, disconnectStand, resolveDomainId } from './stand.js'

const { values } = parseArgs({
  options: {
    email: { type: 'string', default: 'bench@bench.local' },
    password: { type: 'string', default: 'bench' },
    domain: { type: 'string' },
  },
})

await connectStand()

// Only collections this branch adds. `records` keeps the indexes of v1.0.
for (const model of [Rollup, RollupState, User, Workspace, Membership]) {
  await model.createIndexes()
}

const domainId = await resolveDomainId(values.domain)

const existing = await users.byEmail(values.email)
const userId =
  existing?.id ??
  (await users.add({ email: values.email, password: values.password, verified: true, workspaceTitle: 'Bench' })).user.id

const [membership] = await users.memberships(userId)
const domain = await Domain.findOne({ id: domainId }).lean()

// V1.0 ignores the field, so the stand keeps working for it.
if (domain.workspaceId !== membership.workspaceId) {
  await Domain.updateOne({ id: domainId }, { $set: { workspaceId: membership.workspaceId } })
}

signale.success(`User ${values.email} owns workspace ${membership.workspaceId} with domain ${domainId}`)

await disconnectStand()
