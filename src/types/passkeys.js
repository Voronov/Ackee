import gql from 'graphql-tag'

export default gql`
  type Passkey {
    id: ID!
    name: String!
    created: DateTime!
    lastUsed: DateTime
  }

  input AddPasskeyInput {
    """
    A name to tell the passkeys apart, like "MacBook" or "YubiKey".
    """
    name: String!
    """
    The browser's answer to the registration options, as JSON.
    """
    response: String!
  }

  type AddPasskeyPayload {
    success: Boolean!
    payload: Passkey
  }

  extend type Query {
    """
    The viewer's passkeys.
    """
    passkeys: [Passkey!]!
  }

  extend type Mutation {
    """
    Options for navigator.credentials.create, as JSON. For a signed-in viewer only.
    """
    passkeyRegistrationOptions: String!
    """
    Adds a passkey from the browser's answer.
    """
    addPasskey(input: AddPasskeyInput!): AddPasskeyPayload!
    """
    Removes one of the viewer's passkeys.
    """
    deletePasskey(id: ID!): Success!
    """
    Options for navigator.credentials.get, as JSON. Needs no token: it starts a sign-in.
    """
    passkeySignInOptions: String!
    """
    Signs in with the browser's answer to the sign-in options and returns a token, like createToken.
    """
    createTokenWithPasskey(response: String!): CreateTokenPayload!
  }
`
