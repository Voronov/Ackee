import crypto from 'node:crypto'

import UserToken from '../models/UserToken.js'

// The token that goes into a link is random and never stored. Only its hash is kept, so
// a copy of the database cannot be turned into a working link.
//
// A plain SHA-256 is enough here, unlike for passwords: the token has 256 bits of entropy
// already, so there is nothing to guess and nothing to slow an attacker down for.
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex')

export const issue = async (userId, purpose) => {
  const token = crypto.randomBytes(32).toString('base64url')

  await UserToken.create({ userId, purpose, hash: digest(token) })

  return token
}

/*
 * Redeems a token and reports what happened.
 *
 * "Used" and "unknown" are told apart on purpose: following the same link twice is a
 * normal mistake and deserves a clear answer, while an unknown link may be a typo.
 */
export const redeem = async (token, purpose) => {
  const entry = await UserToken.findOne({ hash: digest(token), purpose })

  if (entry == null) return { status: 'UNKNOWN' }
  if (entry.used === true) return { status: 'USED' }
  if (entry.expires < new Date()) return { status: 'EXPIRED' }

  // Marked as used in one atomic step, so two clicks at the same moment cannot both win.
  const claimed = await UserToken.findOneAndUpdate(
    { id: entry.id, used: false },
    { $set: { used: true } },
    { returnDocument: 'after' },
  )

  if (claimed == null) return { status: 'USED' }

  return { status: 'OK', userId: entry.userId }
}

// Old links of the same kind stop working as soon as a new one is sent.
//
// Marked as used rather than deleted, on purpose. The rate limit below counts tokens, so
// deleting them would reset the count with every new request and the limit would never
// bite. They disappear on their own when they expire.
export const revoke = (userId, purpose) =>
  UserToken.updateMany({ userId, purpose, used: false }, { $set: { used: true } })

// How many links of this kind were sent to the user recently. Used to rate limit sending.
export const recentCount = (userId, purpose, since) =>
  UserToken.countDocuments({ userId, purpose, created: { $gte: since } })
