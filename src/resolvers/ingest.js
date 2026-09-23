import { mergeResolvers } from '@graphql-tools/merge'

import actions from './actions.js'
import records from './records.js'

export default mergeResolvers([{ Query: { ok: () => true } }, records, actions])
