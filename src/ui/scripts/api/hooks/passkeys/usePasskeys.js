import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

import useQuery from '../../utils/useQuery.js'

const PASSKEYS = gql`
  query passkeys {
    passkeys {
      id
      name
      created
      lastUsed
    }
  }
`

const REGISTRATION_OPTIONS = gql`
  mutation passkeyRegistrationOptions {
    passkeyRegistrationOptions
  }
`

const ADD = gql`
  mutation addPasskey($input: AddPasskeyInput!) {
    addPasskey(input: $input) {
      success
    }
  }
`

const DELETE = gql`
  mutation deletePasskey($id: ID!) {
    deletePasskey(id: $id) {
      success
    }
  }
`

const SIGN_IN_OPTIONS = gql`
  mutation passkeySignInOptions {
    passkeySignInOptions
  }
`

const SIGN_IN = gql`
  mutation createTokenWithPasskey($response: String!) {
    createTokenWithPasskey(response: $response) {
      payload {
        id
      }
    }
  }
`

const refetch = { refetchQueries: [{ query: PASSKEYS }], awaitRefetchQueries: true }

export default () => {
  const selector = (data) => data?.passkeys
  const enhancer = (passkeys = []) => passkeys

  return useQuery(PASSKEYS, selector, enhancer, { fetchPolicy: 'cache-and-network' })
}

// Asks the browser for a new passkey and hands its answer to the server (ACKEE-80)
export const useAddPasskey = () => {
  const [options] = useMutation(REGISTRATION_OPTIONS)
  const [add] = useMutation(ADD, refetch)

  return async (name) => {
    const { data } = await options()
    const answer = await startRegistration({ optionsJSON: JSON.parse(data.passkeyRegistrationOptions) })

    await add({ variables: { input: { name, response: JSON.stringify(answer) } } })
  }
}

export const useDeletePasskey = () => {
  const [remove] = useMutation(DELETE, refetch)

  return (id) => remove({ variables: { id } })
}

// Signs in with a passkey the browser offers, and returns the session token
export const useSignInWithPasskey = () => {
  const [options] = useMutation(SIGN_IN_OPTIONS)
  const [signIn, { loading, error }] = useMutation(SIGN_IN)

  const run = async () => {
    const { data } = await options()
    const answer = await startAuthentication({ optionsJSON: JSON.parse(data.passkeySignInOptions) })
    const result = await signIn({ variables: { response: JSON.stringify(answer) } })

    return result.data.createTokenWithPasskey.payload.id
  }

  return { run, loading, error }
}
