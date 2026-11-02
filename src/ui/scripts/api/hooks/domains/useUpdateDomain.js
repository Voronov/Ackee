import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

import domainFields from '../../fragments/domainFields.js'

const MUTATION = gql`
  mutation updateDomain($id: ID!, $input: UpdateDomainInput!) {
    updateDomain(id: $id, input: $input) {
      payload {
        ...domainFields
      }
    }
  }

  ${domainFields}
`

export default (id) => {
  const [mutate, { loading, error }] = useMutation(MUTATION, {
    variables: {
      id,
    },
  })

  return {
    mutate: (options) =>
      mutate({
        optimisticResponse: {
          updateDomain: {
            payload: {
              id,
              title: options.variables.input.title,
              ...(options.variables.input.collectCountry == null
                ? {}
                : { collectCountry: options.variables.input.collectCountry }),
              __typename: 'Domain',
            },
            __typename: 'UpdateDomainPayload',
          },
        },
        ...options,
      }),
    loading,
    error,
  }
}
