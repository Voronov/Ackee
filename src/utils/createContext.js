import { getClientIp } from 'request-ip'

import config from './config.js'
import createDate from './createDate.js'
import { isSet } from './ignoreCookie.js'
import resolveViewer from './viewer.js'

export const createServerlessContext = (request) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')
  const headers = Object.fromEntries(request.headers)
  return createContext(ip, headers)
}

export const createExpressContext = ({ req }) => {
  return createContext(getClientIp(req), req.headers)
}

const createContext = async (ip, headers) => {
  return {
    isDemoMode: config.isDemoMode,
    // An identity, not a flag: either a viewer with workspaces or a KnownError.
    viewer: await resolveViewer(headers['authorization'], config.ttl),
    isIgnored: isSet(headers['cookie']),
    dateDetails: createDate(headers['time-zone']),
    userAgent: headers['user-agent'],
    // Ingest key and origin, both read straight from the request. Kept in the context so
    // that the tracking resolver does not have to know about headers.
    ingestKey: headers['x-ackee-key'],
    origin: headers['origin'],
    ip,
    // Variables used by to set and read cookies and headers
    setCookies: [],
    setHeaders: [],
  }
}
