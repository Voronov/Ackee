import { gql } from '@apollo/client'

import useQuery from '../../utils/useQuery.js'

export const WORKSPACES = gql`
  query workspaces {
    workspaces {
      id
      title
      role
      canManageMembers
      members {
        id
        email
        role
        domainIds
      }
      invitations {
        id
        email
        role
        domainIds
        expires
      }
      domains {
        id
        title
      }
    }
  }
`

export default () => {
  const selector = (data) => data?.workspaces
  const enhancer = (workspaces = []) => workspaces

  return useQuery(WORKSPACES, selector, enhancer, {
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
  })
}
