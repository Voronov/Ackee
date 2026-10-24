import { assignDefaultWorkspace, dropOldRecordIndexes } from './database/migrations.js'
import * as ingestQueue from './queue/redis.js'
import { start as startGa4Sync } from './ga4/sync.js'
import server from './server.js'
import config from './utils/config.js'
import connect from './utils/connect.js'
import { check as mailCheck } from './utils/mailer.js'
import { start as startRollups } from './utils/rollupJob.js'
import signale from './utils/signale.js'
import stripUrlAuth from './utils/stripUrlAuth.js'

if (config.dbUrl == null) {
  signale.fatal('MongoDB connection URI missing in environment')
  process.exit(1)
}

try {
  ingestQueue.checkConfig()
} catch (error) {
  signale.fatal(error.message)
  process.exit(1)
}

server.on('listening', () => signale.watch(`Listening on http://localhost:${config.port}`))
server.on('error', (error) => signale.fatal(error))

signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)

connect(config.dbUrl)
  .then(async () => {
    signale.success(`Connected to ${stripUrlAuth(config.dbUrl)}`)

    const moved = await assignDefaultWorkspace()
    if (moved.domains + moved.events > 0) {
      signale.info(`Moved ${moved.domains} domains and ${moved.events} events into the default workspace`)
    }

    if (await dropOldRecordIndexes()) {
      signale.info('Dropped the old domainId index of records')
    }

    signale.start(`Starting the server`)

    server.listen(config.port)

    mailCheck()

    // Pulls the connected GA4 properties at start and every three hours (ACKEE-21)
    startGa4Sync()

    startRollups()

    // In this process for now, ACKEE-19 moves it into one of its own
    if (ingestQueue.isEnabled() === true) {
      ingestQueue.start()
      signale.info(`Ingest queue at ${ingestQueue.describe(config.ingestQueue)}`)
    }

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
