import PropTypes from 'prop-types'
import { createElement as h } from 'react'

import AnalyticsConnection from '../AnalyticsConnection.js'
import Input from '../Input.js'
import Label from '../Label.js'
import Spacer from '../Spacer.js'
import Text from '../Text.js'
import Textarea from '../Textarea.js'

import useDeleteDomain from '../../api/hooks/domains/useDeleteDomain.js'
import useUpdateDomain from '../../api/hooks/domains/useUpdateDomain.js'
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
  const gtmId = shortId()

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

      h(Label, { htmlFor: gtmId }, 'Google Tag Manager'),

      h(Textarea, {
        id: gtmId,
        readOnly: true,
        rows: 4,
        // The same snippet. Tag Manager pastes it into the page, so nothing about it
        // changes — what changes is who owns the markup.
        value: `<script async src="${srcUrl}" data-ackee-server="${serverUrl}" data-ackee-domain-id="${trackingId}"></script>`,
        copyOnFocus: true,
      }),

      h(
        Text,
        { type: 'p', className: 'color-secondary' },
        'Paste this into a Custom HTML tag with an All Pages trigger. Leave "Support document.write" off.',
      ),

      h(Spacer, { size: 1 }),

      h(AnalyticsConnection, { domainId: props.id }),

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
  ingestKey: PropTypes.string,
  ...commonModalProps,
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
}

export default ModalDomainEdit
