import { ROLE_OWNER } from '../constants/roles.js'
import * as auditLog from '../database/auditLog.js'
import * as passkeys from '../database/passkeys.js'
import * as tokens from '../database/tokens.js'
import * as users from '../database/users.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'
import requireAuth from '../middlewares/requireAuth.js'
import { on as ignoreCookieOn } from '../utils/ignoreCookie.js'
import KnownError from '../utils/KnownError.js'
import pipe from '../utils/pipe.js'

const requireEnabled = () => {
  if (passkeys.isEnabled() === false) throw new KnownError('Passkeys need ACKEE_URL, which is not set')
}

// The browser's answer arrives as JSON text
const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    throw new KnownError('The answer of the browser could not be read')
  }
}

// Passkey changes and sign-ins go to the audit log of the user's own workspaces
const record = async (account, action, targetId) => {
  for (const membership of await users.memberships(account.userId)) {
    if (membership.role === ROLE_OWNER) await auditLog.record(account, membership.workspaceId, action, targetId)
  }
}

export default {
  Query: {
    passkeys: pipe(requireAuth, (parent, args, { viewer }) => passkeys.all(viewer.userId)),
  },
  Mutation: {
    passkeyRegistrationOptions: pipe(requireAuth, blockDemoMode, async (parent, args, { viewer }) => {
      requireEnabled()

      return JSON.stringify(await passkeys.registrationOptions({ id: viewer.userId, email: viewer.email }))
    }),
    addPasskey: pipe(requireAuth, blockDemoMode, async (parent, { input }, { viewer }) => {
      requireEnabled()

      const name = String(input.name ?? '').trim()
      if (name === '' || name.length > 100) throw new KnownError('Give the passkey a name of up to 100 characters')

      const result = await passkeys.register({ id: viewer.userId }, parse(input.response), name)
      if (typeof result === 'string') throw new KnownError(result)

      await record(viewer, 'passkey.add', result.id)

      return { success: true, payload: result }
    }),
    deletePasskey: pipe(requireAuth, blockDemoMode, async (parent, { id }, { viewer }) => {
      const entry = await passkeys.del(id, viewer.userId)
      if (entry == null) throw new KnownError('Unknown passkey')

      await record(viewer, 'passkey.delete', id)

      return { success: true }
    }),
    passkeySignInOptions: async () => {
      requireEnabled()

      return JSON.stringify(await passkeys.authenticationOptions())
    },
    createTokenWithPasskey: async (parent, { response }, { setCookies }) => {
      requireEnabled()

      const result = await passkeys.authenticate(parse(response))
      if (typeof result === 'string') throw new KnownError(result)

      const user = await users.get(result.userId)
      if (user == null) throw new KnownError('This passkey is not known here')

      const entry = await tokens.add(user.id)

      // The same as signing in with a password: your own visits are not counted
      setCookies.push(ignoreCookieOn)
      await record({ userId: user.id, email: user.email }, 'user.signIn.passkey', user.id)

      return { success: true, payload: { id: entry.id, created: entry.created, updated: entry.updated } }
    },
  },
}
