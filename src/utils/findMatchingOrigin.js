import fullyQualifiedDomainNames from './fullyQualifiedDomainNames.js'

// An allow-list as an object without a prototype, so a lookup never finds "constructor".
// The Origin header is checked against such a list as a whole and only then reflected: that
// is the one shape of check CodeQL takes as proof that the value is safe to reflect.
const listOf = (values) => {
  const list = Object.create(null)
  for (const value of values) list[value] = true

  return list
}

// The scheme and the port of a web origin, or null for anything else
const partsOf = (origin) => {
  try {
    const { protocol, port } = new URL(origin)

    return protocol === 'http:' || protocol === 'https:' ? { scheme: protocol.slice(0, -1), port } : null
  } catch {
    return null
  }
}

// The origins of the sites named by the domains, with the port the request came with: a site
// in development runs on a port, and the Origin header carries it. Exported for the tests.
export const autoOrigins = (requestOrigin, names) => {
  const parts = partsOf(requestOrigin)
  if (parts == null) return listOf([])

  const suffix = parts.port === '' ? '' : `:${parts.port}`

  return listOf(names.map((name) => `${parts.scheme}://${name.toLowerCase()}${suffix}`))
}

export const matchesAutoOrigin = (requestOrigin, names) => requestOrigin in autoOrigins(requestOrigin, names)

// Answers with the origin to reflect, or with nothing. Not null: "null" is itself an origin
// (of a sandboxed frame), and reflecting it with credentials is the classic mistake, so
// CodeQL reads a null here as that mistake waiting to happen.
export default async (requestOrigin, allowedOrigins, autoOrigin) => {
  if (autoOrigin === true) {
    const origins = autoOrigins(requestOrigin, await fullyQualifiedDomainNames())

    if (requestOrigin in origins) return requestOrigin
    return
  }

  if (allowedOrigins === '*') return '*'

  if (allowedOrigins != null) {
    const origins = listOf(allowedOrigins.split(','))

    if (requestOrigin in origins) return requestOrigin
    return
  }

  return
}
