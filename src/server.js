import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'
import { expressMiddleware } from '@as-integrations/express5'
import express from 'express'
import helmet from 'helmet'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import config from './utils/config.js'
import createApolloServer from './utils/createApolloServer.js'
import { createExpressContext } from './utils/createContext.js'
import { directivesFor } from './utils/contentSecurityPolicy.js'
import * as customTracker from './utils/customTracker.js'
import * as ingestGate from './utils/ingestGate.js'
import findMatchingOrigin from './utils/findMatchingOrigin.js'
import google from './google.js'
import autotrackLoader from './autotrack/loader.js'
import live from './live/router.js'
import pages from './pages.js'
import KnownError from './utils/KnownError.js'
import mcp from './mcp/server.js'
import exportReport from './export.js'
import * as metrics from './utils/metrics.js'
import signale from './utils/signale.js'

const __dirname = import.meta.dirname

const loadFile = (filename) => readFile(path.resolve(__dirname, '../dist', filename)).catch(signale.fatal)

const html = 'text/html; charset=utf-8'
const javascript = 'text/javascript; charset=utf-8'

// Route, file in dist and content type of every static file.
const staticFiles = [
  ['/', 'index.html', html],
  ['/index.html', 'index.html', html],
  ['/favicon.ico', 'favicon.ico', 'image/vnd.microsoft.icon'],
  ['/index.css', 'index.css', 'text/css; charset=utf-8'],
  ['/index.js', 'index.js', javascript],
  ['/tracker.js', 'tracker.js', javascript],
]

if (customTracker.exists === true) staticFiles.push([customTracker.url, 'tracker.js', javascript])

// Each file is read once, even when two routes serve it.
const files = new Map()
for (const [, filename] of staticFiles) {
  if (files.has(filename) === false) files.set(filename, loadFile(filename))
}

const handleGraphError = (formattedError, error) => {
  // This part is for error that happen inside GraphQL resolvers.
  // All known errors should be thrown as a KnownError as those
  // errors will only show up in the response and as a warning
  // in the console output.

  const suitableError = error.originalError || error
  const isKnownError = suitableError instanceof KnownError

  // Only log the full error stack when the error isn't a known response
  if (isKnownError === false) {
    signale.fatal(suitableError)
    return formattedError
  }

  signale.warn(suitableError.message)
  return formattedError
}

const attachCorsHeaders = async (request, response, next) => {
  const matchingOrigin = await findMatchingOrigin(request.headers.origin, config.allowOrigin, config.autoOrigin)

  if (matchingOrigin != null) {
    response.setHeader('Access-Control-Allow-Origin', matchingOrigin)
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Time-Zone, X-Ackee-Key')
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Max-Age', '3600')
  }

  next()
}

const app = express()

// Disable the X-Powered-By header and set other security headers. The policy needs the inline
// scripts of the generated UI, so it waits for the file.
const securityHeaders = files.get('index.html').then((file) =>
  helmet({
    // Allow the tracker and UI assets to be loaded cross-origin
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: { useDefaults: false, directives: directivesFor(String(file)) },
  }),
)

app.use(async (request, response, next) => {
  const headers = await securityHeaders
  headers(request, response, next)
})

// Response timing has to cover every route, so it goes before them.
app.use(metrics.httpMiddleware)

// Create HTTP server before Apollo Server (needed for drain plugin)
const server = http.createServer(app)

const apolloServer = createApolloServer({
  formatError: handleGraphError,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer: server }), metrics.apolloPlugin, ingestGate.plugin], // eslint-disable-line new-cap
})

// Apply CORS middleware
app.use(attachCorsHeaders)

// Respond to preflight requests
app.options('/{*path}', (request, response) => {
  response.sendStatus(204)
})

// An ingest process serves the tracker and nothing else (ACKEE-19)
app.use(ingestGate.gate)

// Prometheus. Answers 404 until ACKEE_METRICS_TOKEN is set.
app.get('/metrics', metrics.handler)
// Pages that links in emails point at: confirming an address and resetting a password.
app.use(pages)
// Sign-in with Google. Answers 404 until ACKEE_GOOGLE_CLIENT_ID and ACKEE_GOOGLE_CLIENT_SECRET are set.
app.use(google)

// /t/<id>.js: the tracker with the tracking rules of a domain (ACKEE-25)
app.use(autotrackLoader)
// Live feed of views as Server-Sent Events (ADR-007). Before Apollo, which takes all of /api.
app.use(live)

// Serve static files
for (const [route, filename, type] of staticFiles) {
  app.get(route, async (request, response) => {
    response.setHeader('Content-Type', type)
    response.end(await files.get(filename))
  })
}

// Start Apollo Server and apply middleware
await apolloServer.start()
app.use(
  '/api',
  express.json(),
  expressMiddleware(apolloServer, {
    context: createExpressContext,
  }),
)

// Read-only MCP endpoint for AI assistants (ACKEE-27, ADR-008). Its own JSON parser: the
// one above is mounted on /api only.
app.post('/mcp', express.json(), mcp)

// Stateless, so there is no stream to open with GET and no session to end with DELETE. A GET
// would hold a stream open forever, so every other method gets 405, as in the SDK example.
app.all('/mcp', (request, response) => {
  response
    .status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32_000, message: 'Method not allowed.' }, id: null })
})

// Reports as CSV or JSON files for the token's viewer (ACKEE-22)
app.get('/export/:file', exportReport)

// Handle 404 errors for unmatched routes (must be after Apollo middleware)
app.use((request, response) => {
  signale.warn(`\`${request.url}\` not found`)
  response.status(404).send('Not found')
})

export default server
