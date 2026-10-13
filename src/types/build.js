import gql from 'graphql-tag'

export default gql`
  type Build {
    """
    Which build is running: a version tag or sha-<commit>, or "local" outside CI.
    """
    id: String!
    """
    Version from package.json.
    """
    version: String!
    """
    Whether the server is connected to its database right now.
    """
    database: Boolean!
  }

  extend type Query {
    """
    What is running here. Readable without a token, so a deploy can check a stand.
    """
    build: Build!
  }
`
