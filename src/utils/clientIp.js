import config from './config.js'

// The client sets X-Forwarded-For and similar headers itself. Only the entries added by our
// own proxies can be trusted, so we count ACKEE_TRUST_PROXY hops from the right and ignore the rest.
const pick = (forwardedFor, remoteAddress) => {
  const chain = String(forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (remoteAddress != null) chain.push(remoteAddress)

  return chain[Math.max(chain.length - 1 - config.trustProxy, 0)]
}

export const ofExpress = (request) => pick(request.headers['x-forwarded-for'], request.socket?.remoteAddress)

// A serverless function has no socket. The platform appends the real client as the last entry.
export const ofFetch = (request) =>
  pick(request.headers.get('x-forwarded-for')) ?? request.headers.get('x-real-ip') ?? undefined
