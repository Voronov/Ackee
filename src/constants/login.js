import { minute } from '../utils/times.js'

// Five wrong passwords per address in fifteen minutes, then the address waits. Enough for
// typos, far too few to guess a ten-character password.
export const LOGIN_ATTEMPTS = 5
export const LOGIN_WINDOW = 15 * minute
