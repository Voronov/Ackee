// Keeps what an async lookup found for ttl ms, then serves it for one more ttl while a single
// shared lookup refreshes it. Callers wait only for an unknown key or a value older than that.
// Nothing found is not kept; a failed refresh keeps the value. forget(key) drops an entry.
export default (lookup, ttl, now = Date.now) => {
  const cache = new Map()

  // What a lookup finds lands only in the entry it was started for, and only while that entry
  // is still in the cache: a lookup that was under way when the key was forgotten is stale.
  const refresh = (key, entry) => {
    entry.pending ??= lookup(key).then(
      (result) => {
        entry.pending = undefined
        if (cache.get(key) !== entry) return result

        if (result == null) {
          cache.delete(key)
        } else {
          entry.value = result
          entry.expires = now() + ttl
        }

        return result
      },
      (error) => {
        entry.pending = undefined
        if (cache.get(key) === entry && entry.value === undefined) cache.delete(key)
        throw error
      },
    )

    return entry.pending
  }

  const cached = (key) => {
    let entry = cache.get(key)

    if (entry == null) {
      entry = {}
      cache.set(key, entry)
    }

    // A value expired for more than another ttl is not served: a key nobody asked for in a
    // long time could otherwise come back with whatever it was an hour ago
    if (entry.value === undefined || now() - entry.expires >= ttl) return refresh(key, entry)

    // The caller already has its answer, a failure here only means the next call tries again
    if (entry.expires <= now()) refresh(key, entry).catch(() => {})

    return Promise.resolve(entry.value)
  }

  cached.forget = (key) => {
    cache.delete(key)
  }

  return cached
}
