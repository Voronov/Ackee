import gql from 'graphql-tag'

export default gql`
  type User {
    """
    User identifier.
    """
    id: ID!
    """
    Email address, which is also the login.
    """
    email: String!
    """
    Whether the address has been confirmed. Unconfirmed accounts cannot sign in.
    """
    verified: Boolean!
    """
    Identifies the date and time when the object was created.
    """
    created: DateTime!
  }

  type Signup {
    """
    Whether anyone can create an account on this instance right now.
    """
    allowed: Boolean!
  }

  input CreateUserInput {
    email: String!
    password: String!
  }

  type CreateUserPayload {
    success: Boolean!
    payload: User
  }

  extend type Query {
    """
    The user behind the current token.
    """
    viewer: User
    """
    Whether registration is currently possible. Readable without a token, because
    the sign-in screen needs it before anyone has signed in.
    """
    signup: Signup!
  }

  type Success {
    success: Boolean!
  }

  input ResetPasswordInput {
    token: String!
    password: String!
  }

  extend type Mutation {
    """
    Creates an account together with its personal workspace. Governed by ACKEE_ALLOW_SIGNUP.
    """
    createUser(input: CreateUserInput!): CreateUserPayload!
    """
    Confirms an address with the token from the email.
    """
    verifyUser(token: String!): Success!
    """
    Sends the confirmation email again. Always reports success, so that it cannot be used
    to find out which addresses have an account.
    """
    resendVerification(email: String!): Success!
    """
    Starts a password reset. Always reports success, for the same reason.
    """
    requestPasswordReset(email: String!): Success!
    """
    Sets a new password using the token from the email.
    """
    resetPassword(input: ResetPasswordInput!): Success!
  }
`
