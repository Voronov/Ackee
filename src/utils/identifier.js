import crypto from 'node:crypto'

import salt from './salt.js'

export default async (ip, userAgent, domainId) => {
  return crypto
    .createHash('sha256')
    .update(`${await salt()}${ip}${userAgent}${domainId}`)
    .digest('hex')
}
