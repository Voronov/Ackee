// Whether a domain title is a name for people rather than a host name. The server cannot check the
// origin of a visit against such a title, so strict mode lets it through (utils/matchesOrigin.js).
export default (title) => {
  const host = String(title).trim()

  return host !== '' && (host.includes('.') === false || host.includes(' ') === true)
}
