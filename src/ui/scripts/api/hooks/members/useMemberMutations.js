import { gql } from '@apollo/client'
import { useMutation } from '@apollo/client/react'

import { WORKSPACES } from './useWorkspaces.js'

// Members and invitations change together (accepting turns one into the other), so every
// mutation simply reads the list again instead of patching the cache.
const refetch = { refetchQueries: [{ query: WORKSPACES }], awaitRefetchQueries: true }

const INVITE = gql`
  mutation inviteMember($input: InviteMemberInput!) {
    inviteMember(input: $input) {
      success
    }
  }
`

const REVOKE = gql`
  mutation revokeInvitation($id: ID!) {
    revokeInvitation(id: $id) {
      success
    }
  }
`

const REMOVE = gql`
  mutation removeMember($id: ID!) {
    removeMember(id: $id) {
      success
    }
  }
`

const useRefetchingMutation = (mutation) => {
  const [mutate, { loading, error }] = useMutation(mutation, refetch)

  return { mutate, loading, error }
}

export const useInviteMember = () => useRefetchingMutation(INVITE)
export const useRevokeInvitation = () => useRefetchingMutation(REVOKE)
export const useRemoveMember = () => useRefetchingMutation(REMOVE)
