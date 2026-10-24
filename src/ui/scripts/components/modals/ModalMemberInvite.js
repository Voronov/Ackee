import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import Input from '../Input.js'
import Label from '../Label.js'
import Message from '../Message.js'
import Select from '../Select.js'
import Spacer from '../Spacer.js'
import Spinner from '../Spinner.js'

import { useInviteMember } from '../../api/hooks/members/useMemberMutations.js'
import useInputs from '../../hooks/useInputs.js'
import commonModalProps from '../../utils/commonModalProps.js'
import shortId from '../../utils/shortId.js'

const ROLES = [
  { value: 'VIEWER', label: 'Viewer: reads reports' },
  { value: 'EDITOR', label: 'Editor: also manages domains and events' },
  { value: 'OWNER', label: 'Owner: everything, including members' },
]

const ModalMemberInvite = (props) => {
  const inviteMember = useInviteMember()
  const loading = inviteMember.loading === true

  const [inputs, onInputChange] = useInputs({ email: '', role: 'VIEWER' })
  // No domain ticked means the whole workspace
  const [domainIds, setDomainIds] = useState([])
  const [error, setError] = useState()

  const toggle = (id) => () =>
    setDomainIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))

  const onSubmit = async (event) => {
    event.preventDefault()
    setError()

    try {
      await inviteMember.mutate({
        variables: { input: { workspaceId: props.workspaceId, email: inputs.email, role: inputs.role, domainIds } },
      })
      props.closeModal()
    } catch (error_) {
      setError(error_.message)
    }
  }

  const emailId = shortId()
  const roleId = shortId()

  return h(
    'form',
    { className: 'card', onSubmit },
    h(
      'div',
      { className: 'card__inner' },

      h(Spacer, { size: 0.5 }),

      h(Label, { htmlFor: emailId }, 'Email address'),
      h(Input, {
        type: 'email',
        id: emailId,
        required: true,
        disabled: loading,
        focused: true,
        placeholder: 'name@example.com',
        value: inputs.email,
        onChange: onInputChange('email'),
      }),

      h(Label, { htmlFor: roleId }, 'Role'),
      h(Select, { id: roleId, disabled: loading, value: inputs.role, items: ROLES, onChange: onInputChange('role') }),

      props.domains.length > 0 && h(Label, {}, 'Limit to domains (none ticked: the whole workspace)'),
      ...props.domains.map((domain) =>
        h(
          'label',
          { key: domain.id, className: 'checkbox' },
          h('input', {
            type: 'checkbox',
            disabled: loading,
            checked: domainIds.includes(domain.id),
            onChange: toggle(domain.id),
          }),
          ` ${domain.title}`,
        ),
      ),

      error != null && h(Spacer, { size: 0.5 }),
      error != null && h(Message, { status: 'error' }, error),
    ),
    h(
      'div',
      { className: 'card__footer' },
      h('button', { type: 'button', className: 'card__button link', onClick: props.closeModal }, 'Close'),
      h('div', { className: 'card__separator ' }),
      h(
        'button',
        { className: 'card__button card__button--primary link color-white', disabled: loading },
        loading ? h(Spinner) : 'Send invitation',
      ),
    ),
  )
}

ModalMemberInvite.propTypes = {
  ...commonModalProps,
  workspaceId: PropTypes.string.isRequired,
  domains: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired, title: PropTypes.string.isRequired }))
    .isRequired,
}

export default ModalMemberInvite
