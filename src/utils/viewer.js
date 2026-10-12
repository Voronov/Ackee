import * as permanentTokens from '../database/permanentTokens.js'
import * as tokens from '../database/tokens.js'
import * as users from '../database/users.js'
import config from './config.js'
import isExpired from './isExpired.js'
import KnownError from './KnownError.js'

// The owner of a token. Tokens from before accounts have none and belong to the env admin.
const owner = (entry) => {
  if (entry.userId != null) return users.get(entry.userId)
  if (config.username == null) return null

  return users.ensureAdmin(config.username)
}

const tokenOwner = async (token, ttl) => {
  const tokenEntry = await tokens.get(token)

  if (tokenEntry != null) {
    // Session tokens expire when unused.
    if (isExpired(tokenEntry.updated, ttl) === true) return null

    await tokens.update(token)

    return owner(tokenEntry)
  }

  const permanentTokenEntry = await permanentTokens.get(token)

  if (permanentTokenEntry != null) {
    // Records the last time the token was used.
    await permanentTokens.update(token, { title: permanentTokenEntry.title })

    return owner(permanentTokenEntry)
  }

  return null
}

// Returns who sent the request with their workspaces, or the KnownError that `requireAuth` throws.
export default async (authorization, ttl) => {
  if (authorization == null) return new KnownError('Token missing')

  const [key, token] = authorization.split(' ')

  if (key !== 'Bearer' || token == null) return new KnownError('Token missing')

  // Also null when the user behind a token was deleted.
  const user = await tokenOwner(token, ttl)

  if (user == null) return new KnownError('Token invalid')

  return {
    userId: user.id,
    email: user.email,
    memberships: await users.memberships(user.id),
  }
}
