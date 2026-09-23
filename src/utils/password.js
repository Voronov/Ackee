import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)

// Password hashing uses scrypt from the built-in crypto module, not bcrypt or argon2.
//
// The reason is practical: both popular libraries are native modules that have to be
// compiled per platform. Ackee is installed from Docker, from npm and on Vercel, and a
// dependency that needs a compiler breaks where it is hardest to fix.
//
// scrypt is a proper memory-hard key derivation function, which is what this needs.
const PARAMETERS = { N: 16_384, r: 8, p: 1, keylen: 64 }

export const hash = async (password) => {
  const salt = crypto.randomBytes(16)
  const derived = await scrypt(password, salt, PARAMETERS.keylen, PARAMETERS)

  return ['scrypt', PARAMETERS.N, PARAMETERS.r, PARAMETERS.p, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  )
}

export const verify = async (password, stored) => {
  if (typeof stored !== 'string') return false

  const [algorithm, n, r, p, salt, expected] = stored.split('$')

  if (algorithm !== 'scrypt') return false

  try {
    const derived = await scrypt(password, Buffer.from(salt, 'base64'), PARAMETERS.keylen, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    const expectedBuffer = Buffer.from(expected, 'base64')

    // Constant-time comparison: a plain check would return sooner or later depending on
    // where the first difference is, and that timing is a measurable hint.
    return derived.length === expectedBuffer.length && crypto.timingSafeEqual(derived, expectedBuffer)
  } catch {
    return false
  }
}
