import gql from 'graphql-tag'

export default gql`
  """
  Where a report reads from: Ackee's own records, or the days synced from Google Analytics 4.
  """
  enum StatisticsSource {
    ACKEE
    GA4
  }

  """
  A domain's link to a Google Analytics 4 property, read with a service account.
  """
  type Ga4Connection {
    propertyId: String!
    """
    The service account Ackee reads with. It needs the Viewer role on the property.
    """
    clientEmail: String!
    """
    The days the synced data covers, as YYYY-MM-DD.
    """
    firstDate: String
    lastDate: String
    lastSync: DateTime
    """
    Why the last sync failed, in Google's words.
    """
    lastError: String
    syncing: Boolean!
  }

  input ConnectGa4Input {
    """
    The property id, a number under Admin → Property details.
    """
    propertyId: String!
    """
    The JSON key of the service account, as Google Cloud downloads it.
    """
    key: String!
  }

  type ConnectGa4Payload {
    success: Boolean!
    payload: Ga4Connection
  }

  extend type Domain {
    ga4: Ga4Connection
  }

  extend type Query {
    """
    Whether this instance can keep GA4 keys: ACKEE_SECRET_KEY is set.
    """
    ga4Available: Boolean!
  }

  extend type Mutation {
    """
    Links a domain to a GA4 property and starts the first sync.
    """
    connectGa4(domainId: ID!, input: ConnectGa4Input!): ConnectGa4Payload!
    """
    Unlinks the property and deletes the days synced from it.
    """
    disconnectGa4(domainId: ID!): Success!
    """
    Syncs the property now instead of waiting for the next run.
    """
    syncGa4(domainId: ID!): ConnectGa4Payload!
  }
`
