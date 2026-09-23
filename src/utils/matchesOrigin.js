/*
 * Whether a request came from the site the domain describes.
 *
 * A second hurdle next to the ingest key, not a boundary: an Origin header is trivial to
 * set from a script, so this only stops traffic sent from a browser on another site. The
 * key stops the rest.
 *
 * A domain whose title is not a host name, such as "My blog", cannot be checked this way,
 * so it passes. Strict mode is opt-in, and the owner who turns it on names their domain
 * after their site.
 */
export default (origin, title) => {
  if (title == null) return true

  const host = String(title).trim().toLowerCase()

  // Nothing to compare against: the title is a label rather than a host name.
  if (host.includes('.') === false || host.includes(' ') === true) return true
  if (origin == null) return false

  try {
    return new URL(origin).hostname.toLowerCase() === host
  } catch {
    return false
  }
}
