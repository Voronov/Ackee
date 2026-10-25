import { minute } from './times.js'

// Counts the calls of each address in a window of a minute. updateRecord needs no sign-in, so
// anyone can send touches of made-up ids (ADR-006); this stops one address from filling the queue.
export default (now = Date.now) => {
  const windows = new Map()
  let swept = now()

  // Returns false once the address used its limit in the current window. A limit of 0 is off.
  return (ip, limit) => {
    if (limit === 0) return true

    const time = now()

    // Without it every address ever seen would stay in memory
    if (time - swept >= minute) {
      for (const [key, entry] of windows) if (time - entry.start >= minute) windows.delete(key)
      swept = time
    }

    const entry = windows.get(ip)

    if (entry == null || time - entry.start >= minute) {
      windows.set(ip, { start: time, count: 1 })
      return true
    }

    entry.count++
    return entry.count <= limit
  }
}
