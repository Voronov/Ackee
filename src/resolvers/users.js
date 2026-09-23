import * as userTokens from '../database/userTokens.js'
import * as users from '../database/users.js'
import config from '../utils/config.js'
import { sendPasswordReset, sendVerification } from '../utils/emails.js'
import { isEnabled as mailEnabled } from '../utils/mailer.js'
import { hour } from '../utils/times.js'
import KnownError from '../utils/KnownError.js'
import messages from '../utils/messages.js'
import pipe from '../utils/pipe.js'
import requireAuth from '../middlewares/requireAuth.js'
import blockDemoMode from '../middlewares/blockDemoMode.js'

// A shape check, not an existence one: only a message to the address can confirm it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Length instead of required symbols, as NIST SP 800-63B recommends. Rules like "one
// capital and one digit" produce predictable passwords, not strong ones.
const MINIMUM_PASSWORD_LENGTH = 10

// At most three links of one kind per hour. Without this, either form could be used to
// flood someone's mailbox.
const MAXIMUM_EMAILS_PER_HOUR = 3

const withinSendingLimit = async (userId, purpose) => {
  const sent = await userTokens.recentCount(userId, purpose, new Date(Date.now() - hour))

  return sent < MAXIMUM_EMAILS_PER_HOUR
}

export default {
  Query: {
    // No requireAuth: the sign-in screen asks this before anyone has signed in.
    signup: () => ({ allowed: config.allowSignup === true }),
    viewer: pipe(requireAuth, (parent, args, { viewer }) => {
      return users.get(viewer.userId)
    }),
  },
  Mutation: {
    createUser: pipe(blockDemoMode, async (parent, { input }) => {
      const email = String(input.email ?? '')
        .trim()
        .toLowerCase()
      const password = String(input.password ?? '')

      if (EMAIL.test(email) === false) throw new KnownError('Email address looks invalid')
      if (password.length < MINIMUM_PASSWORD_LENGTH) {
        throw new KnownError(`Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters long`)
      }

      if (config.allowSignup !== true) throw new KnownError('Registration is closed on this instance')

      if ((await users.byEmail(email)) != null) {
        throw new KnownError('Email address is already in use')
      }

      let created

      try {
        created = await users.add({
          email,
          password,
          // Without outgoing mail nobody could confirm an address, so on an instance
          // with no SMTP the account is usable straight away.
          verified: mailEnabled() === false,
          workspaceTitle: 'Personal',
        })
      } catch (error) {
        if (error.name === 'ValidationError') throw new KnownError(messages(error.errors))

        // The unique index catches two registrations for the same address arriving at
        // once, when both pass the check above.
        if (error.code === 11_000) throw new KnownError('Email address is already in use')

        throw error
      }

      if (mailEnabled() === true) {
        await sendVerification(email, await userTokens.issue(created.user.id, 'VERIFY'))
      }

      return {
        success: true,
        payload: created.user,
      }
    }),
    verifyUser: async (parent, { token }) => {
      const result = await userTokens.redeem(token, 'VERIFY')

      if (result.status === 'USED') throw new KnownError('This link has already been used')
      if (result.status === 'EXPIRED') throw new KnownError('This link has expired')
      if (result.status !== 'OK') throw new KnownError('This link is not valid')

      await users.verify(result.userId)

      return { success: true }
    },
    // Both of the next two always report success. Saying "no such address" would turn
    // either form into a way to find out who has an account here.
    resendVerification: async (parent, { email }) => {
      const user = await users.byEmail(email)

      if (user != null && user.verified === false && (await withinSendingLimit(user.id, 'VERIFY'))) {
        await userTokens.revoke(user.id, 'VERIFY')
        await sendVerification(user.email, await userTokens.issue(user.id, 'VERIFY'))
      }

      return { success: true }
    },
    requestPasswordReset: async (parent, { email }) => {
      const user = await users.byEmail(email)

      if (user != null && (await withinSendingLimit(user.id, 'RESET'))) {
        await userTokens.revoke(user.id, 'RESET')
        await sendPasswordReset(user.email, await userTokens.issue(user.id, 'RESET'))
      }

      return { success: true }
    },
    resetPassword: async (parent, { input }) => {
      const password = String(input.password ?? '')

      if (password.length < MINIMUM_PASSWORD_LENGTH) {
        throw new KnownError(`Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters long`)
      }

      const result = await userTokens.redeem(input.token, 'RESET')

      if (result.status === 'USED') throw new KnownError('This link has already been used')
      if (result.status === 'EXPIRED') throw new KnownError('This link has expired')
      if (result.status !== 'OK') throw new KnownError('This link is not valid')

      // A reset also confirms the address: whoever opened the link reads that mailbox.
      await users.setPassword(result.userId, password)

      return { success: true }
    },
  },
}
