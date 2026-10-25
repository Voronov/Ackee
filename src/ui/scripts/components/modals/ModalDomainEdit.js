import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import Input from '../Input.js'
import Label from '../Label.js'
import Spacer from '../Spacer.js'
import Text from '../Text.js'
import Textarea from '../Textarea.js'

import useDeleteDomain from '../../api/hooks/domains/useDeleteDomain.js'
import useUpdateDomain from '../../api/hooks/domains/useUpdateDomain.js'
import { MODALS_DOMAIN_GA4, MODALS_DOMAIN_TRACKING } from '../../constants/modals.js'
import useInputs from '../../hooks/useInputs.js'
import commonModalProps from '../../utils/commonModalProps.js'
import shortId from '../../utils/shortId.js'

const ModalDomainEdit = (props) => {
  const updateDomain = useUpdateDomain(props.id)
  const deleteDomain = useDeleteDomain(props.id)

  const [inputs, onInputChange] = useInputs({
    title: props.title,
  })

  const onSubmit = (event) => {
    event.preventDefault()
    updateDomain.mutate({
      variables: {
        input: inputs,
      },
    })
    props.closeModal()
  }

  const onDelete = (event) => {
    event.preventDefault()

    const c = confirm(`Are you sure you want to delete the domain "${props.title}"? This action cannot be undone.`)
    if (c === false) return

    deleteDomain.mutate()
    props.closeModal()
  }

  const titleId = shortId()
  const idId = shortId()
  const embedId = shortId()
  const autotrackId = shortId()

  // Without a key the snippet is exactly what it was before, so an existing installation
  // keeps working and nothing has to be updated at once.
  const trackingId = props.ingestKey == null ? props.id : `${props.id}.${props.ingestKey}`

  const trackerUrl = globalThis.env.customTracker.url || '/tracker.js'
  const srcUrl = new URL(trackerUrl, location.href).href
  const serverUrl = location.origin

  return h(
    'form',
    { className: 'card', onSubmit },
    h(
      'div',
      { className: 'card__inner' },

      h(Spacer, { size: 0.5 }),

      h(Label, { htmlFor: titleId }, 'Domain title'),

      h(Input, {
        type: 'text',
        id: titleId,
        required: true,
        focused: true,
        placeholder: 'Domain title',
        value: inputs.title,
        onChange: onInputChange('title'),
      }),

      h(Label, { htmlFor: idId }, 'Domain id'),

      h(Input, {
        type: 'text',
        id: idId,
        readOnly: true,
        placeholder: 'Domain id',
        value: props.id,
        copyOnFocus: true,
      }),

      h(Label, { htmlFor: embedId }, 'Embed code'),

      h(Textarea, {
        id: embedId,
        readOnly: true,
        rows: 4,
        // The id in the snippet carries the ingest key after a dot. The bundled tracker
        // passes the value through untouched, so the key reaches the server without the
        // tracker having to know about it.
        value: `<script async src="${srcUrl}" data-ackee-server="${serverUrl}" data-ackee-domain-id="${trackingId}"></script>`,
        copyOnFocus: true,
      }),

      h(Label, { htmlFor: autotrackId }, 'Embed code with tracking rules'),

      // One snippet for page views and everything set up under Tracking rules (ACKEE-25)
      h(Textarea, {
        id: autotrackId,
        readOnly: true,
        rows: 2,
        value: `<script async src="${serverUrl}/t/${trackingId}.js"></script>`,
        copyOnFocus: true,
      }),

      // Each on a line of its own. Plain buttons: LinkItem would submit the form of this dialog.
      h(
        'div',
        { className: 'linkItem' },
        h(
          'button',
          {
            type: 'button',
            className: 'link',
            onClick: () => props.addModal(MODALS_DOMAIN_TRACKING, { id: props.id, title: props.title }),
          },
          'Tracking rules →',
        ),
      ),

      h(
        'div',
        { className: 'linkItem' },
        h(
          'button',
          {
            type: 'button',
            className: 'link',
            onClick: () => props.addModal(MODALS_DOMAIN_GA4, { id: props.id, title: props.title }),
          },
          'Google Analytics →',
        ),
      ),

      h(Spacer, { size: 0.5 }),

      h(
        Text,
        { type: 'p', className: 'color-secondary' },
        props.ingestKey == null
          ? 'Reopen this domain to see its ingest key.'
          : 'The key in this snippet is visible to anyone who opens your site. It raises the bar for someone sending events to your domain, but it is not a secret. Rotate it if it is being misused.',
      ),
    ),
    h(
      'div',
      { className: 'card__footer' },

      h(
        'button',
        {
          type: 'button',
          className: 'card__button link',
          onClick: props.closeModal,
        },
        'Close',
      ),

      h('div', {
        className: 'card__separator',
      }),

      h(
        'button',
        {
          type: 'button',
          className: 'card__button link color-destructive',
          onClick: onDelete,
        },
        'Delete',
      ),

      h('div', {
        className: 'card__separator',
      }),

      h(
        'button',
        {
          className: 'card__button card__button--primary link color-white',
        },
        'Rename',
      ),
    ),
  )
}

ModalDomainEdit.propTypes = {
  addModal: PropTypes.func,
  ingestKey: PropTypes.string,
  ...commonModalProps,
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
}

export default ModalDomainEdit
