import fullyQualifiedDomainNames from './fullyQualifiedDomainNames.js'

// The host of a web origin, or null for anything else.
const hostOf = (origin) => {
  try {
    const { protocol, hostname } = new URL(origin)

    return protocol === 'http:' || protocol === 'https:' ? hostname : null
  } catch {
    return null
  }
}

// Whether the origin is one of the sites named by the domains. Matched by host rather than
// as a whole string: a site in development runs on a port, and the Origin header carries it.
export const matchesAutoOrigin = (requestOrigin, names) => {
  const host = hostOf(requestOrigin)

  return host != null && names.some((name) => name.toLowerCase() === host)
}

export default async (requestOrigin, allowedOrigins, autoOrigin) => {
  if (autoOrigin === true) {
    return matchesAutoOrigin(requestOrigin, await fullyQualifiedDomainNames()) ? requestOrigin : null
  }

  if (allowedOrigins === '*') return '*'

  if (allowedOrigins != null) {
    const origins = allowedOrigins.split(',')
    return origins.includes(requestOrigin) ? requestOrigin : null
  }

  return null
}
