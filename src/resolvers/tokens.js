import { randomUUID } from 'node:crypto'

import * as loginAttempts from '../database/loginAttempts.js'
import * as tokens from '../database/tokens.js'
import * as users from '../database/users.js'
import config from '../utils/config.js'
import { off as ignoreCookieOff, on as ignoreCookieOn } from '../utils/ignoreCookie.js'
import KnownError from '../utils/KnownError.js'
import { hash, verify } from '../utils/password.js'

// A hash of nothing, so an unknown address costs as much time as a wrong password. Otherwise
// the answer time would tell who has an account.
const DECOY = await hash(randomUUID())

// The user behind the credentials, or null. The env admin first, then registered accounts.
const signIn = async (username, password) => {
  if (config.username != null && config.password != null && username === config.username) {
    if (password !== config.password) return null

    // The env vouches for this account, including one created before addresses were confirmed.
    return { ...(await users.ensureAdmin(config.username)), verified: true }
  }

  const user = await users.credentials(username)
  const matches = await verify(password, user?.password ?? DECOY)

  if (user == null || matches === false) return null

  return user
}

const response = (entry) => ({
  id: entry.id,
  created: entry.created,
  updated: entry.updated,
})

export default {
  Mutation: {
    createToken: async (parent, { input }, { setCookies, ip }) => {
      const { username, password } = input

      if (await loginAttempts.tooMany(username, ip)) {
        throw new KnownError('Too many failed sign-ins for this address, try again in 15 minutes')
      }

      const user = await signIn(username, password)

      if (user == null) {
        await loginAttempts.record(username, ip)
        throw new KnownError('Username or password incorrect')
      }

      // Checked after the password, so it says nothing about an address to someone who does not know it.
      if (user.verified !== true) throw new KnownError('Confirm your email address before signing in')

      await loginAttempts.clear(username, ip)

      const entry = await tokens.add(user.id)

      // Set cookie to avoid reporting your own visits
      setCookies.push(ignoreCookieOn)

      return {
        success: true,
        payload: response(entry),
      }
    },
    deleteToken: async (parent, { id }, { setCookies }) => {
      await tokens.del(id)

      // Remove cookie to report your own visits, again
      setCookies.push(ignoreCookieOff)

      return {
        success: true,
      }
    },
  },
}
