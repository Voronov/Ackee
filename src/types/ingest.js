import { mergeTypeDefs } from '@graphql-tools/merge'
import gql from 'graphql-tag'

import actions from './actions.js'
import records from './records.js'

// The schema of the ingest service: the four mutations a tracker calls and nothing else.
//
// This is the point of splitting the service. A process that accepts anonymous traffic
// should not be able to read reports, list domains or issue tokens, even by mistake —
// those operations simply do not exist in its schema.
const root = gql`
  type Query {
    """
    Present because GraphQL requires a query root. Reading happens in the other service.
    """
    ok: Boolean!
  }
`

export default mergeTypeDefs([root, records, actions], { all: true })
