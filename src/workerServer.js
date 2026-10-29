import express from 'express'
import http from 'node:http'

import * as metrics from './utils/metrics.js'

/*
 * What a worker process answers on its port (ACKEE-19): enough for the health check of the
 * image (GET / and the query of POST /api, see healthcheck.js) and for Prometheus to scrape
 * the counters of the queue. No API, no UI: those belong to the other roles.
 */
export const createWorkerApp = () => {
  const app = express()

  app.disable('x-powered-by')
  app.get('/', (request, response) => response.type('text/plain').send('Ackee worker'))
  app.post('/api', (request, response) => response.json({ data: { __typename: 'Query' } }))
  app.get('/metrics', metrics.handler)
  app.use((request, response) => response.status(404).send('Not found'))

  return app
}

export default http.createServer(createWorkerApp())
