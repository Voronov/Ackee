import { start as startAnalyticsSync } from './import/sync.js'
import { start as startRollupWorker } from './rollups/worker.js'
import server from './server.js'
import config from './utils/config.js'
import { migrate as clickhouseMigrate } from './utils/clickhouse.js'
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

server.on('listening', () => signale.watch(`Listening on http://localhost:${config.port}`))
server.on('error', (error) => signale.fatal(error))

signale.await(`Connecting to ${stripUrlAuth(config.dbUrl)}`)

connect(config.dbUrl)
  .then(() => {
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
    clickhouseMigrate().catch(signale.fatal)
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
