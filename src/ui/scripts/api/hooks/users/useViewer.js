import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'

const QUERY = gql`
  query {
    viewer {
      id
      email
    }
  }
`

// Who is signed in. The header needs it for the avatar and the menu under it.
export default () => {
  const { data, loading } = useQuery(QUERY)

  return {
    viewer: data?.viewer ?? null,
    loading,
  }
}
