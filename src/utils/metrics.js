import client from 'prom-client'

import config from './config.js'

// Metrics stay off until ACKEE_METRICS_TOKEN is set. The endpoint exposes an operational
// picture of the installation, so it must not be open by default.
export const isEnabled = () => config.metricsToken != null && config.metricsToken !== ''

export const registry = new client.Registry()

registry.setDefaultLabels({ app: 'ackee' })
client.collectDefaultMetrics({ register: registry, prefix: 'ackee_' })

const httpDuration = new client.Histogram({
  name: 'ackee_http_request_duration_seconds',
  help: 'How long an HTTP request takes',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
})

const graphqlDuration = new client.Histogram({
  name: 'ackee_graphql_operation_duration_seconds',
  help: 'How long a GraphQL operation takes, by root field',
  labelNames: ['operation', 'field', 'outcome'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [registry],
})

const mongoDuration = new client.Histogram({
  name: 'ackee_mongodb_command_duration_seconds',
  help: 'How long a MongoDB command takes, as measured by the driver',
  labelNames: ['command', 'collection', 'outcome'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [registry],
})

const rollupBuild = new client.Histogram({
  name: 'ackee_rollup_build_duration_seconds',
  help: 'How long one day of rollups takes to build',
  labelNames: ['mode'],
  buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600],
  registers: [registry],
})

// How far the worst-covered domain lags behind now. A growing value means the worker is
// falling behind and reports are quietly falling back to raw records.
const rollupLag = new client.Gauge({
  name: 'ackee_rollup_lag_seconds',
  help: 'How far the worst-covered rollup range lags behind now',
  registers: [registry],
})

export const observeRollupBuild = (mode, seconds) => {
  if (isEnabled() === false) return

  rollupBuild.observe({ mode }, seconds)
}

export const setRollupLag = (seconds) => {
  if (isEnabled() === false) return

  rollupLag.set(seconds)
}

// Routes are listed explicitly. A label taken from an arbitrary request path would blow
// up cardinality and make the metrics store unusable.
const KNOWN_ROUTES = new Set([
  '/',
  '/api',
  '/index.html',
  '/index.css',
  '/index.js',
  '/favicon.ico',
  '/tracker.js',
  '/metrics',
])

const routeLabel = (path) => (KNOWN_ROUTES.has(path) ? path : 'other')

export const httpMiddleware = (request, response, next) => {
  if (isEnabled() === false) return next()

  const end = httpDuration.startTimer()

  // Use originalUrl rather than path: Express rewrites req.url when it hands a request to a
  // mounted handler, so by the finish event path is relative to the mount point.
  const route = routeLabel(request.originalUrl.split('?')[0])

  response.on('finish', () => {
    end({ method: request.method, route, status: response.statusCode })
  })

  next()
}

// The GraphQL root field is a fine enough label to separate reads from writes, and coarse
// enough not to blow up cardinality.
const rootFields = (operation) => {
  const selections = operation?.selectionSet?.selections ?? []
  const names = selections.map((selection) => selection.name?.value).filter(Boolean)

  return names.length === 0 ? 'unknown' : [...new Set(names)].toSorted().join(',')
}

export const apolloPlugin = {
  requestDidStart() {
    if (isEnabled() === false) return {}

    const started = process.hrtime.bigint()
    let field = 'unknown'
    let operation = 'unknown'

    return {
      didResolveOperation({ operation: parsed }) {
        operation = parsed.operation
        field = rootFields(parsed)
      },
      willSendResponse({ errors }) {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9

        graphqlDuration.observe({ operation, field, outcome: errors?.length > 0 ? 'error' : 'ok' }, seconds)
      },
    }
  },
}

// Measured by the driver: more accurate than wrapping the data layer, and it needs no
// changes in the sixteen modules under src/database.
export const instrumentMongo = (client) => {
  if (isEnabled() === false || client == null) return

  const started = new Map()

  client.on('commandStarted', (event) => {
    // The collection has to be read here: the success and failure events carry no command body.
    const collection = event.command?.[event.commandName]

    started.set(event.requestId, {
      time: process.hrtime.bigint(),
      name: event.commandName,
      collection: typeof collection === 'string' ? collection : 'unknown',
    })
  })

  const finish = (event, outcome) => {
    const entry = started.get(event.requestId)
    if (entry == null) return
    started.delete(event.requestId)

    mongoDuration.observe(
      { command: entry.name, collection: entry.collection, outcome },
      Number(process.hrtime.bigint() - entry.time) / 1e9,
    )
  }

  client.on('commandSucceeded', (event) => finish(event, 'ok'))
  client.on('commandFailed', (event) => finish(event, 'error'))
}

// The endpoint stays quiet when metrics are off: 404 rather than 401, so it never
// confirms that it exists.
// Helpers for the event store and the ingest worker. They keep the call sites free of
// registry wiring, and they stay silent while metrics are off, like the rest of this
// module.
const defaultBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export const counter = (name, help) => new client.Counter({ name, help, registers: [registry] })

// For a total the caller already keeps: prom-client reads it when the endpoint is scraped
export const readCounter = (name, help, read) =>
  new client.Counter({ name, help, registers: [registry], collect() { this.reset(); this.inc(read()) } })

export const gauge = (name, help, read) =>
  new client.Gauge({ name, help, registers: [registry], collect() { this.set(read()) } })

export const histogram = (name, help, labelNames = [], buckets = defaultBuckets) =>
  new client.Histogram({ name, help, labelNames, buckets, registers: [registry] })

const reportSeconds = histogram('ackee_report_seconds', 'Time spent answering a report, by report and store', [
  'report',
  'store',
])

export const recordsCreated = counter('ackee_records_created_total', 'Records created through the API')
export const actionsCreated = counter('ackee_actions_created_total', 'Actions created through the API')

// Wraps a report so every call is timed under its own name and store
export const timeReport = (report, store, fn) =>
  async function timedReport(...parameters) {
    const end = reportSeconds.startTimer({ report, store })

    try {
      return await fn(...parameters)
    } finally {
      end()
    }
  }

export const handler = async (request, response) => {
  if (isEnabled() === false) return response.status(404).send('Not found')

  const expected = `Bearer ${config.metricsToken}`
  const provided = request.headers['authorization']

  if (provided !== expected) return response.status(404).send('Not found')

  response.setHeader('Content-Type', registry.contentType)
  response.end(await registry.metrics())
}
