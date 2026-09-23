import crypto from 'node:crypto'

import config from './config.js'

/*
 * Encrypts values that have to be stored but must not be readable in the database.
 *
 * So far that means one thing: the Google service account key a user hands over so Ackee
 * can read their Analytics property. That key is a real credential — it opens their
 * Google account, not ours — and a database backup should not be enough to use it.
 *
 * AES-256-GCM, so a tampered value fails to decrypt rather than decrypting into something
 * else. The key comes from ACKEE_SECRET; without it this is off and the features that
 * depend on it refuse to store anything.
 */
const ALGORITHM = 'aes-256-gcm'

export const isEnabled = () => config.secret != null && config.secret !== ''

// The secret is a passphrase of any length, so it is hashed into a key of the right size.
const keyOf = () => crypto.createHash('sha256').update(String(config.secret)).digest()

export const encrypt = (value) => {
  if (isEnabled() === false) throw new Error('ACKEE_SECRET missing in environment')

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, keyOf(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])

  // Everything needed to read it back, except the key: version, nonce, tag, payload.
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.')
}

export const decrypt = (value) => {
  if (isEnabled() === false) throw new Error('ACKEE_SECRET missing in environment')

  const [version, iv, tag, payload] = String(value).split('.')

  if (version !== 'v1') throw new Error('Unknown secret format')

  const decipher = crypto.createDecipheriv(ALGORITHM, keyOf(), Buffer.from(iv, 'base64'))

  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8')
}
