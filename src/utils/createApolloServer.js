import { ApolloServer } from '@apollo/server'
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled'
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default'
import {
  DateTimeResolver,
  DateTimeTypeDefinition,
  PositiveFloatResolver,
  PositiveFloatTypeDefinition,
  UnsignedIntResolver,
  UnsignedIntTypeDefinition,
  URLResolver,
  URLTypeDefinition,
} from 'graphql-scalars'

import resolvers from '../resolvers/index.js'
import typeDefs from '../types/index.js'
import config from './config.js'

// Reads setCookies and setHeaders arrays from the context and applies them to the HTTP response headers
const formatCookie = ({ name, value, options = {} }) => {
  const parts = [`${name}=${value}`]

  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options.secure) parts.push('Secure')
  if (options.httpOnly) parts.push('HttpOnly')

  return parts.join('; ')
}

const httpHeadersPlugin = {
  requestDidStart() {
    return {
      willSendResponse({ contextValue, response }) {
        if (contextValue.setCookies?.length > 0) {
          for (const cookie of contextValue.setCookies) {
            const cookieString = typeof cookie === 'string' ? cookie : formatCookie(cookie)
            response.http?.headers.set('set-cookie', cookieString)
          }
        }
        if (contextValue.setHeaders?.length > 0) {
          for (const { key, value } of contextValue.setHeaders) {
            response.http?.headers.set(key, value)
          }
        }
      },
    }
  },
}

export default (options = {}) => {
  // The schema can be swapped, for the ingest service, but the scalar definitions below
  // always come along. Overwriting the whole array would drop them and leave the schema
  // referring to types that no longer exist.
  const {
    plugins: extraPlugins = [],
    typeDefs: ownTypeDefs = typeDefs,
    resolvers: ownResolvers = resolvers,
    ...restOptions
  } = options

  return new ApolloServer({
    introspection: config.isDemoMode === true || config.isDevelopmentMode === true,
    hideSchemaDetailsFromClientErrors: config.isDevelopmentMode === false,
    includeStacktraceInErrorResponses: config.isDevelopmentMode === true,
    allowBatchedHttpRequests: true,
    plugins: [
      httpHeadersPlugin,
      config.isDemoMode === true || config.isDevelopmentMode === true
        ? ApolloServerPluginLandingPageLocalDefault() // eslint-disable-line new-cap
        : ApolloServerPluginLandingPageDisabled(), // eslint-disable-line new-cap
      ...extraPlugins,
    ],
    typeDefs: [
      UnsignedIntTypeDefinition,
      DateTimeTypeDefinition,
      PositiveFloatTypeDefinition,
      URLTypeDefinition,
      ownTypeDefs,
    ],
    resolvers: {
      UnsignedInt: UnsignedIntResolver,
      DateTime: DateTimeResolver,
      PositiveFloat: PositiveFloatResolver,
      URL: URLResolver,
      ...ownResolvers,
    },
    ...restOptions,
  })
}
