import { LOGIN_ATTEMPTS, LOGIN_WINDOW } from '../constants/login.js'
import LoginAttempt from '../models/LoginAttempt.js'

// One count per address and client. A stranger who knows an address cannot lock its owner
// out from somewhere else, while guessing from one place is still stopped.
const keyOf = (address, ip) => `${String(address).trim().toLowerCase()} ${ip ?? ''}`

export const record = (address, ip) => LoginAttempt.create({ key: keyOf(address, ip) })

export const tooMany = async (address, ip) => {
  const since = new Date(Date.now() - LOGIN_WINDOW)
  const count = await LoginAttempt.countDocuments({ key: keyOf(address, ip), created: { $gte: since } })

  return count >= LOGIN_ATTEMPTS
}

// A successful sign-in starts the count over, for this client only.
export const clear = (address, ip) => LoginAttempt.deleteMany({ key: keyOf(address, ip) })
