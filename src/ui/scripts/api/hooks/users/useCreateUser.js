import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

const MUTATION = gql`
  mutation createUser($input: CreateUserInput!) {
    createUser(input: $input) {
      payload {
        id
        email
        verified
      }
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
