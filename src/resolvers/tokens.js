import * as tokens from '../database/tokens.js'
import * as users from '../database/users.js'
import { off as ignoreCookieOff, on as ignoreCookieOn } from '../utils/ignoreCookie.js'
import KnownError from '../utils/KnownError.js'
import { hash, verify } from '../utils/password.js'

const response = (entry) => ({
  id: entry.id,
  created: entry.created,
  updated: entry.updated,
})

// A hash of nothing, so the check still runs for an unknown address. Without it, signing
// in with an unregistered address would answer noticeably faster, and the form would
// become a way to find out who has an account.
const DECOY = await hash(`decoy-${Math.random()}`)

export default {
  Mutation: {
    createToken: async (parent, { input }, { setCookies }) => {
      const { username, password } = input

      const user = await users.byEmail(username)
      const matches = await verify(password, user?.password ?? DECOY)

      // One message for both cases: an unknown address and a wrong password must be
      // indistinguishable.
      if (user == null || matches === false) throw new KnownError('Username or password incorrect')

      if (user.verified === false) throw new KnownError('Account is not verified yet')

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
