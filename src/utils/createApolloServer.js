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
          // All cookies at once, as a list: setting them one by one kept only the last.
          // Express turns the list into one Set-Cookie header per cookie.
          const cookies = contextValue.setCookies.map((cookie) =>
            typeof cookie === 'string' ? cookie : formatCookie(cookie),
          )
          response.http?.headers.set('set-cookie', cookies)
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
  const { plugins: extraPlugins = [], ...restOptions } = options

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
      typeDefs,
    ],
    resolvers: {
      UnsignedInt: UnsignedIntResolver,
      DateTime: DateTimeResolver,
      PositiveFloat: PositiveFloatResolver,
      URL: URLResolver,
      ...resolvers,
    },
    ...restOptions,
  })
}
