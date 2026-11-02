import { assignDefaultWorkspace, dropOldRecordIndexes } from './database/migrations.js'
import * as ingestQueue from './queue/redis.js'
import { start as startGa4Sync } from './ga4/sync.js'
import server from './server.js'
import config from './utils/config.js'
import connect from './utils/connect.js'
import { check as mailCheck } from './utils/mailer.js'
import { ROLES, isRole, serves } from './utils/roles.js'
import { start as startRollups } from './utils/rollupJob.js'
import signale from './utils/signale.js'
import stripUrlAuth from './utils/stripUrlAuth.js'
import workerServer from './workerServer.js'

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

if (isRole(config.role) === false) {
  signale.fatal(`ACKEE_ROLE must be one of ${ROLES.join(', ')}, not '${config.role}'`)
  process.exit(1)
}

// A worker listens too, for the health check and Prometheus, but not with the app (ACKEE-19)
const listener = serves('http') === true ? server : workerServer

listener.on('listening', () => signale.watch(`Listening on http://localhost:${config.port} as ${config.role}`))
listener.on('error', (error) => signale.fatal(error))

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

    listener.listen(config.port)

    // Emails go out from the app: registration, invitations, reset links
    if (serves('app') === true) mailCheck()

    // The background work of the instance: in every process with role all, in a worker alone
    // otherwise, so an api or ingest process answers requests and does nothing else (ACKEE-19)
    if (serves('jobs') === true) {
      // Pulls the connected GA4 properties at start and on a schedule (ACKEE-21)
      startGa4Sync()

      startRollups()

      if (ingestQueue.isEnabled() === true) {
        ingestQueue.start()
        signale.info(`Ingest queue at ${ingestQueue.describe(config.ingestQueue)}, writing from it`)
      }
    } else if (ingestQueue.isEnabled() === true) {
      signale.info(`Ingest queue at ${ingestQueue.describe(config.ingestQueue)}, a worker writes from it`)
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
