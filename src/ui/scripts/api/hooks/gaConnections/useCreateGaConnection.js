import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

const MUTATION = gql`
  mutation createGaConnection($input: CreateGaConnectionInput!) {
    createGaConnection(input: $input) {
      success
      payload {
        id
        propertyId
        serviceAccountEmail
      }
    }
  }
`

export default () => {
  const [mutate, { loading, error }] = useMutation(MUTATION)

  return { mutate, loading, error }
}
