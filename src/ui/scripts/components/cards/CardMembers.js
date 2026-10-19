import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import { useRemoveMember, useRevokeInvitation } from '../../api/hooks/members/useMemberMutations.js'
import { MODALS_MEMBER_INVITE } from '../../constants/modals.js'

import Line from '../Line.js'
import LinkItem from '../LinkItem.js'
import CardSetting from './CardSetting.js'

// Shown with the domain titles, so the owner sees at a glance who is limited to what
const scope = (domainIds, domains) => {
  if (domainIds.length === 0) return ''

  const titles = domainIds.map((id) => domains.find((domain) => domain.id === id)?.title ?? id)

  return ` · ${titles.join(', ')}`
}

const CardMembers = (props) => {
  const removeMember = useRemoveMember()
  const revokeInvitation = useRevokeInvitation()
  const { workspace } = props

  const onRemove = (member) => () => {
    if (confirm(`Remove ${member.email} from "${workspace.title}"?`) === false) return
    removeMember.mutate({ variables: { id: member.id } }).catch((error) => alert(error.message))
  }

  const onRevoke = (invitation) => () => {
    if (confirm(`Revoke the invitation for ${invitation.email}?`) === false) return
    revokeInvitation.mutate({ variables: { id: invitation.id } })
  }

  const onInvite = () => props.addModal(MODALS_MEMBER_INVITE, { workspaceId: workspace.id, domains: workspace.domains })

  return h(
    CardSetting,
    { headline: `Members · ${workspace.title}` },
    ...workspace.members.flatMap((member) => [
      h(
        LinkItem,
        {
          type: 'button',
          text: `${member.role}${scope(member.domainIds, workspace.domains)}`,
          onClick: onRemove(member),
        },
        member.email,
      ),
      h(Line),
    ]),
    ...workspace.invitations.flatMap((invitation) => [
      h(
        LinkItem,
        {
          type: 'button',
          text: `invited · ${invitation.role}${scope(invitation.domainIds, workspace.domains)}`,
          onClick: onRevoke(invitation),
        },
        invitation.email,
      ),
      h(Line),
    ]),
    h(LinkItem, { type: 'button', onClick: onInvite }, 'Invite member'),
  )
}

CardMembers.propTypes = {
  workspace: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    members: PropTypes.array.isRequired,
    invitations: PropTypes.array.isRequired,
    domains: PropTypes.array.isRequired,
  }).isRequired,
  addModal: PropTypes.func.isRequired,
}

export default CardMembers
