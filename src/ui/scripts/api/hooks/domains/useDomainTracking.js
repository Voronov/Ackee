import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

import useQuery from '../../utils/useQuery.js'

const FIELDS = `
  gtmId
  outbound
  downloads
  downloadExtensions
  scroll
  vitals
  rules {
    id
    type
    selector
    label
    path
  }
`

const QUERY = gql`
  query domainTracking($id: ID!) {
    domain(id: $id) {
      id
      tracking {
        ${FIELDS}
      }
    }
  }
`

const MUTATION = gql`
  mutation updateDomainTracking($id: ID!, $input: DomainTrackingInput!) {
    updateDomainTracking(id: $id, input: $input) {
      success
    }
  }
`

// What a domain collects besides page views (ACKEE-25)
export default (id) => {
  const selector = (data) => data?.domain?.tracking
  const enhancer = (tracking) => tracking

  return useQuery(QUERY, selector, enhancer, { variables: { id }, fetchPolicy: 'network-only' })
}

export const useUpdateDomainTracking = (id) => {
  const [mutate, { loading }] = useMutation(MUTATION, { refetchQueries: [{ query: QUERY, variables: { id } }] })

  return { save: (input) => mutate({ variables: { id, input } }), loading }
}
