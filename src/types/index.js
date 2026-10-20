import { mergeTypeDefs } from '@graphql-tools/merge'

import actions from './actions.js'
import auditLog from './auditLog.js'
import build from './build.js'
import domains from './domains.js'
import domainStatistics from './domainStatistics.js'
import events from './events.js'
import eventStatistics from './eventStatistics.js'
import facts from './facts.js'
import miscellaneous from './miscellaneous.js'
import permanentTokens from './permanentTokens.js'
import records from './records.js'
import tracking from './tracking.js'
import tokens from './tokens.js'
import users from './users.js'

export default mergeTypeDefs(
  [
    tokens,
    tracking,
    users,
    permanentTokens,
    records,
    domains,
    events,
    actions,
    facts,
    miscellaneous,
    domainStatistics,
    eventStatistics,
    build,
    auditLog,
  ],
  { all: true },
)
