import gql from 'graphql-tag'

export default gql`
  type GaConnection {
    id: ID!
    """
    The Ackee domain this fills with data.
    """
    domainId: ID!
    """
    The numeric Analytics property id, not the G-XXXXXXXXXX measurement id.
    """
    propertyId: String!
    """
    The service account the key belongs to. Shown so you can tell which account you
    connected; the key itself is never returned.
    """
    serviceAccountEmail: String!
    """
    The last day already imported. Syncing continues from the day after.
    """
    syncedUntil: DateTime
    """
    Why the last run failed, if it did. A revoked key shows up here.
    """
    lastError: String
    created: DateTime!
  }

  input CreateGaConnectionInput {
    domainId: ID!
    propertyId: String!
    """
    The whole service account key file, as JSON.
    """
    credentials: String!
  }

  type GaConnectionPayload {
    success: Boolean!
    payload: GaConnection
  }

  extend type Query {
    """
    The Analytics connection of a domain, if it has one.
    """
    gaConnection(domainId: ID!): GaConnection
  }

  extend type Mutation {
    """
    Connects a domain to an Analytics property. The key is checked against the property
    before anything is stored, so a wrong one fails here rather than silently at night.
    """
    createGaConnection(input: CreateGaConnectionInput!): GaConnectionPayload!
    """
    Disconnects a domain. Records already imported stay where they are.
    """
    deleteGaConnection(domainId: ID!): Success!
  }
`
