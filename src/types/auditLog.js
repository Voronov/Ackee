import gql from 'graphql-tag'

export default gql`
  type AuditEntry {
    """
    Entry identifier.
    """
    id: ID!
    """
    Who made the change.
    """
    userId: ID!
    """
    Email address of who made the change, kept after the account is gone.
    """
    email: String
    """
    Workspace the change was made in.
    """
    workspaceId: ID!
    """
    What was done, for example domain.create.
    """
    action: String!
    """
    Identifier of what was changed.
    """
    targetId: ID
    """
    When the change was made.
    """
    created: DateTime!
  }

  extend type Query {
    """
    Recent changes in the workspaces where the viewer may read the audit log. Newest first.
    """
    auditLog(limit: Int = 50): [AuditEntry!]!
  }
`
