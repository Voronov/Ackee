import * as permanentTokens from '../database/permanentTokens.js'
import * as tokens from '../database/tokens.js'
import * as users from '../database/users.js'
import isExpired from './isExpired.js'
import KnownError from './KnownError.js'

/*
 * Identifies the user behind a token.
 *
 * Version 1.0 had a function here that returned `true`: the request knew that it was
 * authenticated but not who by. That is why domains had no owner and anyone signed in
 * saw everything.
 *
 * This returns either a viewer with their workspaces or an error. The shape is kept on
 * purpose: `requireAuth` still throws whatever comes back.
 */
export default async (authorization, ttl) => {
  if (authorization == null) return new KnownError('Token missing')

  const [key, token] = authorization.split(' ')

  if (key !== 'Bearer' || token == null) return new KnownError('Token missing')

  const userId = await (async () => {
    const tokenEntry = await tokens.get(token)

    if (tokenEntry != null) {
      // Session tokens expire when unused.
      if (isExpired(tokenEntry.updated, ttl) === true) return null

      await tokens.update(token)

      return tokenEntry.userId
    }

    const permanentTokenEntry = await permanentTokens.get(token)

    if (permanentTokenEntry != null) {
      await permanentTokens.update(token, { title: permanentTokenEntry.title })

      return permanentTokenEntry.userId
    }

    return null
  })()

  if (userId == null) return new KnownError('Token invalid')

  const user = await users.get(userId)

  // The token outlived its user: the account is gone but the session remained.
  if (user == null) return new KnownError('Token invalid')

  return {
    userId: user.id,
    email: user.email,
    memberships: await users.memberships(user.id),
  }
}
