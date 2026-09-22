import PropTypes from 'prop-types'
import { createElement as h, useState } from 'react'

import Input from './Input.js'
import Label from './Label.js'
import Message from './Message.js'
import Spacer from './Spacer.js'
import Text from './Text.js'
import Textarea from './Textarea.js'

import useCreateGaConnection from '../api/hooks/gaConnections/useCreateGaConnection.js'
import useDeleteGaConnection from '../api/hooks/gaConnections/useDeleteGaConnection.js'
import useGaConnection from '../api/hooks/gaConnections/useGaConnection.js'
import shortId from '../utils/shortId.js'

/*
 * Connects a domain to a Google Analytics property so history keeps arriving by itself.
 *
 * Its own component rather than part of the domain form: the surrounding dialog is already
 * a form, and a form cannot hold another one. The buttons here act on their own.
 */
// A revoked key or a removed property shows up here rather than in a log nobody reads.
const statusOf = (connection) => {
  if (connection.lastError != null) return `Last run failed: ${connection.lastError}`
  if (connection.syncedUntil == null) return 'Nothing imported yet. The first run happens tonight.'

  return `Imported up to ${new Date(connection.syncedUntil).toISOString().slice(0, 10)}.`
}

const AnalyticsConnection = (props) => {
  const connection = useGaConnection(props.domainId)
  const createConnection = useCreateGaConnection()
  const deleteConnection = useDeleteGaConnection()

  const [propertyId, setPropertyId] = useState('')
  const [credentials, setCredentials] = useState('')

  const propertyFieldId = shortId()
  const keyFieldId = shortId()

  const loading = createConnection.loading === true || deleteConnection.loading === true
  const error = createConnection.error ?? deleteConnection.error

  const onConnect = async () => {
    await createConnection.mutate({
      variables: { input: { domainId: props.domainId, propertyId: propertyId.trim(), credentials } },
    })

    setCredentials('')
    connection.refetch?.()
  }

  const onDisconnect = async () => {
    await deleteConnection.mutate({ variables: { domainId: props.domainId } })
    connection.refetch?.()
  }

  const existing = connection.value

  return h(
    'div',
    {},

    h(Label, {}, 'Google Analytics'),

    error != null && h(Message, { status: 'error' }, error.message),

    existing != null &&
      h(
        'div',
        {},
        h(
          Text,
          { type: 'p', className: 'color-secondary' },
          `Property ${existing.propertyId}, read by ${existing.serviceAccountEmail}.`,
        ),
        h(Text, { type: 'p', className: 'color-secondary' }, statusOf(existing)),
        h(Spacer, { size: 0.5 }),
        h(
          'button',
          {
            type: 'button',
            className: 'card__button link color-destructive',
            disabled: loading,
            onClick: onDisconnect,
          },
          'Disconnect',
        ),
      ),

    existing == null &&
      h(
        'div',
        {},
        h(
          Text,
          { type: 'p', className: 'color-secondary' },
          'Ackee reads the property once a day and adds the visits to this domain. You need the numeric property id and a service account key with read access to it.',
        ),

        h(Label, { htmlFor: propertyFieldId }, 'Property id'),
        h(Input, {
          type: 'text',
          id: propertyFieldId,
          disabled: loading,
          placeholder: '123456789',
          value: propertyId,
          onChange: (event) => setPropertyId(event.target.value),
        }),

        h(Label, { htmlFor: keyFieldId }, 'Service account key'),
        h(Textarea, {
          id: keyFieldId,
          rows: 4,
          disabled: loading,
          placeholder: 'Paste the whole JSON file you downloaded',
          value: credentials,
          onChange: (event) => setCredentials(event.target.value),
        }),

        h(
          Text,
          { type: 'p', className: 'color-secondary' },
          'The key is stored encrypted and never shown again. It is checked against the property before it is saved, so a wrong one fails here rather than quietly at night.',
        ),

        h(Spacer, { size: 0.5 }),
        h(
          'button',
          {
            type: 'button',
            className: 'card__button link',
            disabled: loading || propertyId.trim() === '' || credentials.trim() === '',
            onClick: onConnect,
          },
          loading === true ? 'Checking…' : 'Connect',
        ),
      ),
  )
}

AnalyticsConnection.propTypes = {
  domainId: PropTypes.string.isRequired,
}

export default AnalyticsConnection
