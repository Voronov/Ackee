import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'

const QUERY = gql`
  query {
    signup {
      allowed
    }
  }
`

// Read before anyone signs in, so the screen knows whether to offer registration at all.
export default () => {
  const { data, loading, error } = useQuery(QUERY)

  return {
    allowed: data?.signup?.allowed === true,
    loading,
    error,
  }
}
