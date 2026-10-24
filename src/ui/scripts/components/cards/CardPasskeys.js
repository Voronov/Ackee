import { createElement as h, useState } from 'react'

import usePasskeys, { useAddPasskey, useDeletePasskey } from '../../api/hooks/passkeys/usePasskeys.js'

import Line from '../Line.js'
import LinkItem from '../LinkItem.js'
import Message from '../Message.js'
import CardSetting from './CardSetting.js'

const day = (value) => (value == null ? 'never used' : `used ${new Date(value).toLocaleDateString()}`)

// The viewer's passkeys (ACKEE-80): add one from this browser, remove one that is lost
const CardPasskeys = () => {
  const passkeys = usePasskeys()
  const addPasskey = useAddPasskey()
  const deletePasskey = useDeletePasskey()
  const [error, setError] = useState(null)

  const onAdd = async () => {
    const name = prompt('Name this passkey, for example "MacBook" or "YubiKey"')
    if (name == null || name.trim() === '') return

    setError(null)
    try {
      await addPasskey(name.trim())
    } catch (error_) {
      // A cancelled browser prompt is not an error worth showing
      if (error_.name !== 'NotAllowedError') setError(error_.message)
    }
  }

  const onDelete = (passkey) => () => {
    if (confirm(`Remove the passkey "${passkey.name}"? It will no longer sign you in.`) === false) return
    deletePasskey(passkey.id)
  }

  return h(
    CardSetting,
    { headline: 'Passkeys' },
    error != null && h(Message, { status: 'error' }, error),
    ...passkeys.value.flatMap((passkey) => [
      h(LinkItem, { type: 'button', text: day(passkey.lastUsed), onClick: onDelete(passkey) }, passkey.name),
      h(Line),
    ]),
    h(LinkItem, { type: 'button', onClick: onAdd }, 'Add passkey'),
  )
}

export default CardPasskeys
