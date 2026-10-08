import { mergeResolvers } from '@graphql-tools/merge'

import actions from './actions.js'
import domains from './domains.js'
import domainStatistics from './domainStatistics.js'
import events from './events.js'
import eventStatistics from './eventStatistics.js'
import facts from './facts.js'
import permanentTokens from './permanentTokens.js'
import records from './records.js'
import tokens from './tokens.js'
import users from './users.js'

export default mergeResolvers([
  tokens,
  users,
  permanentTokens,
  records,
  domains,
  events,
  actions,
  facts,
  domainStatistics,
  eventStatistics,
])
