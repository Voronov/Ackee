import gql from 'graphql-tag'

export default gql`
  type Member {
    """
    Membership identifier, used to remove the member.
    """
    id: ID!
    email: String!
    role: String!
    """
    The domains this member is limited to. Empty means every domain of the workspace.
    """
    domainIds: [ID!]!
    created: DateTime!
  }

  type Invitation {
    id: ID!
    email: String!
    role: String!
    domainIds: [ID!]!
    expires: DateTime!
    created: DateTime!
  }

  type Workspace {
    id: ID!
    title: String!
    """
    The viewer's role in this workspace.
    """
    role: String!
    """
    Whether the viewer may invite and remove members.
    """
    canManageMembers: Boolean!
    """
    The members, for those who may manage them. Empty for everyone else.
    """
    members: [Member!]!
    """
    Invitations that can still be accepted, for those who may manage members.
    """
    invitations: [Invitation!]!
    """
    The domains of the workspace an invitation can be limited to, for those who may manage members.
    """
    domains: [Domain!]!
  }

  input InviteMemberInput {
    workspaceId: ID!
    email: String!
    role: String!
    """
    Limits the member to these domains of the workspace. Omit for the whole workspace.
    """
    domainIds: [ID!]
  }

  type InviteMemberPayload {
    success: Boolean!
    payload: Invitation
  }

  extend type Query {
    """
    The workspaces the viewer belongs to.
    """
    workspaces: [Workspace!]!
  }

  extend type Mutation {
    """
    Emails a one-time link that lets the address join the workspace. Needs MEMBERS_MANAGE there.
    """
    inviteMember(input: InviteMemberInput!): InviteMemberPayload!
    """
    Stops a pending invitation from being accepted.
    """
    revokeInvitation(id: ID!): Success!
    """
    Removes a member from the workspace. The last owner cannot be removed.
    """
    removeMember(id: ID!): Success!
  }
`
