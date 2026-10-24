import { createHash, timingSafeEqual } from 'node:crypto'
import client from 'prom-client'

import {
  DROP_INVALID,
  DROP_MALFORMED,
  DROP_UNKNOWN_DOMAIN,
  DROP_UNKNOWN_RECORD,
  DROP_UNKNOWN_TYPE,
  DROP_UNKNOWN_VERSION,
  FALLBACK_FULL,
  FALLBACK_UNAVAILABLE,
  RECORD_CREATE,
  RECORD_TOUCH,
} from '../constants/ingest.js'
import * as ingestQueue from '../queue/redis.js'
import { stats as workerStats } from '../queue/worker.js'
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

// Read from Redis on every scrape. While Redis is away the last value stays: the outage shows
// in the log and in ackee_ingest_fallback_total. Without the queue nothing connects.
const queueGauge = (name, help, read) =>
  new client.Gauge({
    name,
    help,
    registers: [registry],
    async collect() {
      if (ingestQueue.isEnabled() === false) return this.set(0)

      try {
        this.set(await read())
      } catch {
        // Keeps the last value, see above
      }
    },
  })

queueGauge('ackee_ingest_queue_length', 'Events in the ingest queue not written to MongoDB yet', ingestQueue.length)

queueGauge(
  'ackee_ingest_queue_oldest_age_seconds',
  'How long the oldest event in the ingest queue has waited',
  async () => {
    const since = await ingestQueue.oldest()
    return since == null ? 0 : Math.max(0, (Date.now() - since.getTime()) / 1000)
  },
)

// The counts live with the code that counts them. Every known label is reported from zero,
// so a rate is defined before the first event.
const countedBy = (name, help, label, values, read) =>
  new client.Counter({
    name,
    help,
    labelNames: [label],
    registers: [registry],
    collect() {
      this.reset()
      for (const value of values) this.inc({ [label]: value }, 0)
      for (const [value, count] of Object.entries(read())) this.inc({ [label]: value }, count)
    },
  })

countedBy(
  'ackee_ingest_queue_processed_total',
  'Events the ingest worker wrote to MongoDB, by type',
  'type',
  [RECORD_CREATE, RECORD_TOUCH],
  () => workerStats.processed,
)

countedBy(
  'ackee_ingest_queue_dropped_total',
  'Events the ingest worker gave up on, by reason',
  'reason',
  [DROP_MALFORMED, DROP_UNKNOWN_VERSION, DROP_UNKNOWN_TYPE, DROP_INVALID, DROP_UNKNOWN_DOMAIN, DROP_UNKNOWN_RECORD],
  () => workerStats.dropped,
)

countedBy(
  'ackee_ingest_fallback_total',
  'Events written directly because the ingest queue could not take them, by reason',
  'reason',
  [FALLBACK_UNAVAILABLE, FALLBACK_FULL],
  () => ingestQueue.stats.fallback,
)

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

// Compares in constant time: a plain comparison returns sooner the earlier the first wrong
// character is, and that timing would let someone guess the token one character at a time.
// Hashing first gives both sides the same length.
const sameSecret = (provided, expected) => {
  const digest = (value) => createHash('sha256').update(value).digest()

  return timingSafeEqual(digest(provided), digest(expected))
}

// The endpoint stays quiet when metrics are off: 404 rather than 401, so it never
// confirms that it exists.
export const handler = async (request, response) => {
  if (isEnabled() === false) return response.status(404).send('Not found')

  const expected = `Bearer ${config.metricsToken}`
  const provided = String(request.headers['authorization'] ?? '')

  if (sameSecret(provided, expected) === false) return response.status(404).send('Not found')

  response.setHeader('Content-Type', registry.contentType)
  response.end(await registry.metrics())
}
