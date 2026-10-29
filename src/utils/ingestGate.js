import { GraphQLError } from 'graphql'

import * as customTracker from './customTracker.js'
import { serves } from './roles.js'

/*
 * What an ingest process answers (ACKEE-19): the tracker, what the tracker calls, and the
 * health check of the image. Everything else is not there, as on a host that does not
 * serve it: the UI and the reports belong to an api process.
 */

const PATHS = new Set([
  '/metrics',
  '/tracker.js',
  '/api',
  ...(customTracker.exists === true ? [customTracker.url] : []),
])

export const gate = (request, response, next) => {
  if (serves('app') === true) return next()

  if (request.path === '/') return response.type('text/plain').send('Ackee ingest')
  if (PATHS.has(request.path) === true || request.path.startsWith('/t/') === true) return next()

  response.status(404).send('Not found')
}

// The views of the tracker, and the query of the health check
const FIELDS = new Set(['createRecord', 'updateRecord', '__typename'])

export const plugin = {
  requestDidStart() {
    if (serves('app') === true) return {}

    return {
      didResolveOperation({ operation }) {
        const fields = (operation?.selectionSet?.selections ?? []).map((selection) => selection.name?.value)

        if (fields.every((field) => FIELDS.has(field)) === false) {
          throw new GraphQLError('This process takes views only', {
            extensions: { code: 'FORBIDDEN', http: { status: 403 } },
          })
        }
      },
    }
  },
}
