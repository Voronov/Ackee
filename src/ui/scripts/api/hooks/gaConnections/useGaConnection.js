import { gql } from '@apollo/client'

import useQuery from '../../utils/useQuery.js'

const QUERY = gql`
  query gaConnection($domainId: ID!) {
    gaConnection(domainId: $domainId) {
      id
      propertyId
      serviceAccountEmail
      syncedUntil
      lastError
    }
  }
`

export default (domainId) => {
  const selector = (data) => data?.gaConnection
  const enhancer = (connection = null) => connection

  return useQuery(QUERY, selector, enhancer, {
    variables: { domainId },
    fetchPolicy: 'network-only',
  })
}
