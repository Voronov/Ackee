import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

const MUTATION = gql`
  mutation requestPasswordReset($email: String!) {
    requestPasswordReset(email: $email) {
      success
    }
  }
`

export default () => {
  const [mutate, { loading, error }] = useMutation(MUTATION)

  return {
    mutate,
    loading,
    error,
  }
}
