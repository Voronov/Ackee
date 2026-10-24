// Lets a log line through at most once per interval for each key, the first one at once.
// A lasting outage would otherwise repeat the same line on every retry or every event.
export default (interval, now = Date.now) => {
  const last = new Map()

  const sometimes = (key, log) => {
    const time = now()
    if (time - (last.get(key) ?? -Infinity) < interval) return

    last.set(key, time)
    log()
  }

  // Once the trouble is over, the next one is logged at once again
  sometimes.reset = () => last.clear()

  return sometimes
}
