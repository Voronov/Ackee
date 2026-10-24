import crypto from 'node:crypto'

import config from './config.js'

/*
 * Encrypts secrets Ackee has to keep, like the key of a Google service account (ACKEE-21).
 *
 * AES-256-GCM with a key derived from ACKEE_SECRET_KEY. A copy of the database alone then opens
 * nothing; the key lives in the environment, next to the other secrets of the stand.
 */
const keyOf = () => {
  if (!config.secretKey) return null

  return crypto.createHash('sha256').update(config.secretKey).digest()
}

export const isEnabled = () => keyOf() != null

export const seal = (plain) => {
  const key = keyOf()
  if (key == null) throw new Error('ACKEE_SECRET_KEY is not set')

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  return [iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64url')).join('.')
}

export const open = (box) => {
  const key = keyOf()
  if (key == null) throw new Error('ACKEE_SECRET_KEY is not set')

  const [iv, tag, sealed] = String(box)
    .split('.')
    .map((part) => Buffer.from(part, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8')
}
