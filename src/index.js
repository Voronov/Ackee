import { once } from 'node:events'
import { setTimeout } from 'node:timers/promises'

import { start as startAnalyticsSync } from './import/sync.js'
import { close as closeQueue, ping as pingQueue } from './queue/redis.js'
import { start as startRollupWorker } from './rollups/worker.js'
import server from './server.js'
import { closeEventStore, connectEventStore } from './stores/connect.js'
import config, { usesQueue, validateEventStoreConfig, validateIngestQueueConfig } from './utils/config.js'
import connect from './utils/connect.js'
import { ready as geoReady } from './utils/geo.js'
import { check as mailCheck } from './utils/mailer.js'
import { isEnabled as secretsEnabled } from './utils/secrets.js'
import signale from './utils/signale.js'
import stripUrlAuth from './utils/stripUrlAuth.js'

if (config.dbUrl == null) {
  signale.fatal('MongoDB connection URI missing in environment')
  process.exit(1)
}

try {
  validateEventStoreConfig()
  validateIngestQueueConfig()
} catch (error) {
  signale.fatal(error.message)
  process.exit(1)
}

// Events still sitting in the write buffer would be lost with the default signal
// handling. Waiting for the server to close makes sure in-flight requests have pushed
// their rows before the last flush. Apollo re-sends the signal once it has drained, so
// the handler stays registered and ignores that second delivery.
// Longer than Apollo's own drain grace period, so the usual path still wins the race
const shutdownGrace = 15_000

const listenForShutdown = () => {
  let isShuttingDown = false

  const shutdown = async (signal) => {
    if (isShuttingDown === true) return
    isShuttingDown = true

    signale.await(`Received ${signal}, closing the server`)

    // Waiting on 'close' alone is not safe: the live feed holds SSE connections open, so
    // the event only arrives once Apollo's drain plugin forces them shut. Flushing must
    // not depend on that, and a server error during shutdown must not reject here.
    const closed = once(server, 'close').catch(() => {})

    server.close()
    await Promise.race([closed, setTimeout(shutdownGrace)])
    await closeEventStore()
    await closeQueue()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const connectQueue = async () => {
  if (usesQueue() === false) return

  signale.await(`Connecting to Redis at ${stripUrlAuth(config.redisUrl)}`)
  await pingQueue()
  signale.success(`Redis is ready (ingest queue: ${config.ingestQueue}, stream: ${config.redisStream})`)
}

server.on('listening', () => signale.watch(`Listening on http://localhost:${config.port}`))
server.on('error', (error) => signale.fatal(error))

signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)

connect(config.dbUrl)
  .then(connectEventStore)
  .then(connectQueue)
  .then(() => {
    listenForShutdown()
    signale.success(`Connected to ${stripUrlAuth(config.dbUrl)}`)
    signale.start(`Starting ${config.role.toLowerCase()}`)

    // The worker runs on its own in a split setup. In the single-process setup it runs
    // here, as it did before, so nothing changes for an installation that does not split.
    const runsWorker = config.role === 'WORKER' || config.role === 'ALL'

    // A worker has no HTTP surface of its own. Nothing should be able to reach it.
    if (config.role !== 'WORKER') server.listen(config.port)

    if (runsWorker === true) {
      startRollupWorker()

      // Pulling from Analytics belongs with the worker: it is slow, scheduled, and has no
      // business running inside a process that answers requests.
      if (secretsEnabled() === true) startAnalyticsSync()
    }
    geoReady()
    mailCheck()

    if (config.isDevelopmentMode === true) {
      signale.info('Development mode enabled')
    }

    if (config.isDemoMode === true) {
      signale.info('Demo mode enabled')
    }
  })
  .catch((error) => {
    signale.fatal(error)
    process.exit(1)
  })
