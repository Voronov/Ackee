import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'

const QUERY = gql`
  query {
    signup {
      allowed
    }
    signInOptions {
      google
    }
  }
`

// Read before anyone signs in, so the screen knows whether to offer registration and which
// other ways to sign in.
export default () => {
  const { data, loading, error } = useQuery(QUERY)

  return {
    allowed: data?.signup?.allowed === true,
    google: data?.signInOptions?.google === true,
    loading,
    error,
  }
}
