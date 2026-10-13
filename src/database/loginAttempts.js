import { LOGIN_ATTEMPTS, LOGIN_WINDOW } from '../constants/login.js'
import LoginAttempt from '../models/LoginAttempt.js'

const normalize = (key) => String(key).trim().toLowerCase()

export const record = (key) => LoginAttempt.create({ key: normalize(key) })

export const tooMany = async (key) => {
  const since = new Date(Date.now() - LOGIN_WINDOW)
  const count = await LoginAttempt.countDocuments({ key: normalize(key), created: { $gte: since } })

  return count >= LOGIN_ATTEMPTS
}

// A successful sign-in starts the count over.
export const clear = (key) => LoginAttempt.deleteMany({ key: normalize(key) })
