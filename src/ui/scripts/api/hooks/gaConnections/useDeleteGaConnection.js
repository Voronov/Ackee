import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

const MUTATION = gql`
  mutation deleteGaConnection($domainId: ID!) {
    deleteGaConnection(domainId: $domainId) {
      success
    }
  }
`

export default () => {
  const [mutate, { loading, error }] = useMutation(MUTATION)

  return { mutate, loading, error }
}
