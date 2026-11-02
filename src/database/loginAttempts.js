import { LOGIN_ADDRESS_ATTEMPTS, LOGIN_ATTEMPTS, LOGIN_WINDOW } from '../constants/login.js'
import LoginAttempt from '../models/LoginAttempt.js'

// One count per address and client. A stranger who knows an address cannot lock its owner
// out from somewhere else with a few tries, while guessing from one place is still stopped.
// A higher count over all clients stops guessing from many places.
const normalize = (address) => String(address).trim().toLowerCase()
const keyOf = (address, ip) => `${normalize(address)} ${ip ?? ''}`

export const record = (address, ip) => LoginAttempt.create({ key: keyOf(address, ip), address: normalize(address) })

export const tooMany = async (address, ip) => {
  const since = new Date(Date.now() - LOGIN_WINDOW)
  const count = await LoginAttempt.countDocuments({ key: keyOf(address, ip), created: { $gte: since } })
  if (count >= LOGIN_ATTEMPTS) return true

  // A new client per guess must not give endless tries
  const all = await LoginAttempt.countDocuments({ address: normalize(address), created: { $gte: since } })

  return all >= LOGIN_ADDRESS_ATTEMPTS
}

// A successful sign-in starts the count over, for this client only.
export const clear = (address, ip) => LoginAttempt.deleteMany({ key: keyOf(address, ip) })
