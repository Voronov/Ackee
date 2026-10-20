import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

import useQuery from '../../utils/useQuery.js'

const FIELDS = `
  propertyId
  clientEmail
  firstDate
  lastDate
  lastSync
  lastError
  syncing
`

const DOMAIN = gql`
  query domainGa4($id: ID!) {
    ga4Available
    domain(id: $id) {
      id
      ga4 {
        ${FIELDS}
      }
    }
  }
`

const CONNECTED = gql`
  query ga4Connected {
    domains {
      id
      ga4 {
        propertyId
      }
    }
  }
`

const CONNECT = gql`
  mutation connectGa4($domainId: ID!, $input: ConnectGa4Input!) {
    connectGa4(domainId: $domainId, input: $input) {
      success
    }
  }
`

const SYNC = gql`
  mutation syncGa4($domainId: ID!) {
    syncGa4(domainId: $domainId) {
      success
    }
  }
`

const DISCONNECT = gql`
  mutation disconnectGa4($domainId: ID!) {
    disconnectGa4(domainId: $domainId) {
      success
    }
  }
`

// The GA4 connection of one domain (ACKEE-21)
export default (id) =>
  useQuery(
    DOMAIN,
    (data) => data,
    (data) => ({ available: data?.ga4Available === true, connection: data?.domain?.ga4 ?? null }),
    {
      variables: { id },
      fetchPolicy: 'network-only',
      pollInterval: 5000,
    },
  )

// Whether any domain reads GA4, which is when the source switch shows
export const useGa4Connected = () =>
  useQuery(
    CONNECTED,
    (data) => data?.domains,
    (domains = []) => domains.some((domain) => domain.ga4 != null),
    {
      fetchPolicy: 'cache-and-network',
    },
  )

export const useGa4Mutations = (domainId) => {
  const refetch = {
    refetchQueries: [{ query: DOMAIN, variables: { id: domainId } }, { query: CONNECTED }],
    awaitRefetchQueries: true,
  }
  const [connect, connecting] = useMutation(CONNECT, refetch)
  const [sync, syncing] = useMutation(SYNC, refetch)
  const [disconnect, disconnecting] = useMutation(DISCONNECT, refetch)

  return {
    connect: (input) => connect({ variables: { domainId, input } }),
    sync: () => sync({ variables: { domainId } }),
    disconnect: () => disconnect({ variables: { domainId } }),
    loading: connecting.loading || syncing.loading || disconnecting.loading,
  }
}
