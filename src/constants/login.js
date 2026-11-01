import { minute } from '../utils/times.js'

// Five wrong passwords per address and client in fifteen minutes, then that client waits. Enough for
// typos, far too few to guess a ten-character password.
export const LOGIN_ATTEMPTS = 5
export const LOGIN_WINDOW = 15 * minute

// Failed sign-ins for one address from all clients together. Someone with many addresses gets no
// more than this, at the price of locking the owner out for the rest of the window.
export const LOGIN_ADDRESS_ATTEMPTS = 50
