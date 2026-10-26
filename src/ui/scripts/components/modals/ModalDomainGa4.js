import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import useGa4, { useGa4Mutations } from '../../api/hooks/ga4/useGa4.js'
import commonModalProps from '../../utils/commonModalProps.js'
import shortId from '../../utils/shortId.js'

import Input from '../Input.js'
import Label from '../Label.js'
import Message from '../Message.js'
import Spacer from '../Spacer.js'
import Spinner from '../Spinner.js'
import Text from '../Text.js'
import Textarea from '../Textarea.js'

const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', className: 'link' }, text)

// How to get the two things the form asks for. Google moves its menus now and then, so the steps
// name the page rather than every click.
const Steps = (props) =>
  h(
    'ol',
    { className: 'ga4Steps' },
    h(
      'li',
      {},
      'In ',
      link('https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com', 'Google Cloud'),
      ', pick or create a project and enable the Google Analytics Data API.',
    ),
    h(
      'li',
      {},
      'Under ',
      link('https://console.cloud.google.com/iam-admin/serviceaccounts', 'IAM → Service accounts'),
      ', create a service account. It needs no role in the project.',
    ),
    h('li', {}, 'Open it, then Keys → Add key → Create new key → JSON. The browser downloads a file.'),
    h(
      'li',
      {},
      'In ',
      link('https://analytics.google.com/analytics/web/', 'Google Analytics'),
      ', open Admin → Property access management → + → Add users, and add the service account',
      props.email ? h('b', {}, ` ${props.email} `) : ' (its client_email) ',
      'as a Viewer.',
    ),
    h('li', {}, 'Copy the property id from Admin → Property details. It is a number, like 123456789.'),
    h(
      'li',
      {},
      'Paste the id and the whole JSON file below. The key is stored encrypted and used only to read reports.',
    ),
  )

const date = (value) => (value == null ? 'never' : new Date(value).toLocaleString())

// A domain's link to Google Analytics 4 (ACKEE-21): connect, see how far the sync got, disconnect
const ModalDomainGa4 = (props) => {
  const ga4 = useGa4(props.id)
  const actions = useGa4Mutations(props.id)
  const [propertyId, setPropertyId] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState(null)

  const run = (action) => async (event) => {
    event?.preventDefault()
    setError(null)
    try {
      await action()
    } catch (error_) {
      setError(error_.message)
    }
  }

  const onDisconnect = run(async () => {
    if (confirm(`Disconnect Google Analytics from ${props.title}? Its synced days are deleted.`) === false) return
    await actions.disconnect()
  })

  const propertyIdId = shortId()
  const keyId = shortId()
  const connection = ga4.value?.connection
  const emailInKey = (() => {
    try {
      return JSON.parse(key).client_email
    } catch {
      return null
    }
  })()

  const body = (() => {
    if (ga4.value == null) return [h(Spinner, { key: 'spinner' })]
    if (ga4.value.available === false) {
      return [
        h(
          Message,
          { key: 'missing', status: 'warning' },
          'Set ACKEE_SECRET_KEY on the server to connect Google Analytics.',
        ),
      ]
    }
    if (connection != null) {
      return [
        h(
          Text,
          { key: 'property', type: 'p' },
          `Property ${connection.propertyId}, read as ${connection.clientEmail}.`,
        ),
        h(
          Text,
          { key: 'range', type: 'p', className: 'color-secondary' },
          connection.firstDate == null
            ? 'The first sync is running. A year of history takes a few minutes.'
            : `Synced from ${connection.firstDate} to ${connection.lastDate}. Last sync: ${date(connection.lastSync)}${connection.syncing ? ', syncing now' : ''}.`,
        ),
        connection.lastError != null &&
          h(Message, { key: 'error', status: 'error' }, `The last sync failed: ${connection.lastError}`),
      ]
    }
    return [
      h(Steps, { key: 'steps', email: emailInKey }),
      h(Label, { key: 'label-id', htmlFor: propertyIdId }, 'Property id'),
      h(Input, {
        key: 'id',
        type: 'text',
        id: propertyIdId,
        placeholder: '123456789',
        value: propertyId,
        onChange: (event) => setPropertyId(event.target.value),
      }),
      h(Label, { key: 'label-key', htmlFor: keyId }, 'Service account key (JSON)'),
      h(Textarea, {
        key: 'key',
        id: keyId,
        rows: 5,
        placeholder: '{ "type": "service_account", … }',
        value: key,
        onChange: (event) => setKey(event.target.value),
      }),
    ]
  })()

  return h(
    'form',
    { className: 'card', onSubmit: run(() => actions.connect({ propertyId: propertyId.trim(), key })) },
    h(
      'div',
      { className: 'card__inner' },
      h(Spacer, { size: 0.5 }),
      h(
        Text,
        { type: 'p', className: 'color-secondary' },
        `Google Analytics 4 next to Ackee for ${props.title}. Synced regularly.`,
      ),
      ...body,
      error != null && h(Spacer, { size: 0.5 }),
      error != null && h(Message, { status: 'error' }, error),
    ),
    h(
      'div',
      { className: 'card__footer' },
      h('button', { type: 'button', className: 'card__button link', onClick: props.closeModal }, 'Close'),
      h('div', { className: 'card__separator' }),
      connection != null &&
        h(
          'button',
          { type: 'button', className: 'card__button link color-destructive', onClick: onDisconnect },
          'Disconnect',
        ),
      connection != null && h('div', { className: 'card__separator' }),
      connection == null
        ? h(
            'button',
            {
              className: 'card__button card__button--primary link color-white',
              disabled: actions.loading || ga4.value?.available !== true,
            },
            actions.loading ? h(Spinner) : 'Connect',
          )
        : h(
            'button',
            {
              type: 'button',
              className: 'card__button card__button--primary link color-white',
              disabled: actions.loading,
              onClick: run(actions.sync),
            },
            actions.loading ? h(Spinner) : 'Sync now',
          ),
    ),
  )
}

ModalDomainGa4.propTypes = {
  ...commonModalProps,
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
}

export default ModalDomainGa4
