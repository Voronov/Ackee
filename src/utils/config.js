import { day } from './times.js'

export const eventStores = ['mongo', 'dual', 'clickhouse']
export const ingestQueues = ['none', 'redis']

// Must be a function or object that loads and returns the env variables at runtime.
// Otherwise it wouldn't be possible to mock the env variables with mockedEnv.
const config = new Proxy(
  {},
  {
    get(target, property) {
      const data = {
        ttl: process.env.ACKEE_TTL || day,
        port: process.env.ACKEE_PORT || process.env.PORT || 3000,
        dbUrl: process.env.ACKEE_MONGODB || process.env.MONGODB_URI,
        allowOrigin: process.env.ACKEE_ALLOW_ORIGIN,
        autoOrigin: process.env.ACKEE_AUTO_ORIGIN === 'true',
        // Registration is open until it is closed. A closed instance is the exception,
        // for someone who only measures their own sites.
        allowSignup: process.env.ACKEE_ALLOW_SIGNUP !== 'false',
        // Which part of Ackee this process is: API, INGEST, WORKER, or ALL for the
        // single-process setup that version 1.0 had. One image, three roles.
        role: (process.env.ACKEE_ROLE || 'ALL').toUpperCase(),
        // Encrypts credentials that users hand over, such as a Google service account key.
        // Without it those features refuse to store anything rather than storing it plain.
        secret: process.env.ACKEE_SECRET,
        metricsToken: process.env.ACKEE_METRICS_TOKEN,
        rollups: process.env.ACKEE_ROLLUPS === 'true',
        geo: process.env.ACKEE_GEO === 'true',
        // Which store answers reads and takes writes: mongo keeps v1.0 behaviour,
        // dual writes to both while reports stay on Mongo, clickhouse moves reads over.
        eventStore: process.env.ACKEE_EVENT_STORE || 'mongo',
        clickhouseUrl: process.env.ACKEE_CLICKHOUSE,
        clickhouseUser: process.env.ACKEE_CLICKHOUSE_USER || 'default',
        clickhousePassword: process.env.ACKEE_CLICKHOUSE_PASSWORD || '',
        clickhouseDatabase: process.env.ACKEE_CLICKHOUSE_DATABASE || 'ackee',
        // Ingestion either writes inside the request or hands the event to a queue
        // that a separate worker drains.
        ingestQueue: process.env.ACKEE_INGEST_QUEUE || 'none',
        redisUrl: process.env.ACKEE_REDIS_URL,
        redisStream: process.env.ACKEE_REDIS_STREAM || 'ackee:events',
        // Public address of this instance. Used to build the links inside emails, so a
        // wrong value produces links that go nowhere.
        publicUrl: process.env.ACKEE_URL,
        smtpHost: process.env.ACKEE_SMTP_HOST,
        smtpPort: Number(process.env.ACKEE_SMTP_PORT || 465),
        smtpUser: process.env.ACKEE_SMTP_USER,
        smtpPassword: process.env.ACKEE_SMTP_PASSWORD,
        smtpFrom: process.env.ACKEE_SMTP_FROM || process.env.ACKEE_SMTP_USER,
        isDemoMode: process.env.ACKEE_DEMO === 'true',
        isDevelopmentMode: process.env.NODE_ENV === 'development',
        isPreBuildMode: process.env.BUILD_ENV === 'pre',
      }

      return data[property]
    },
  },
)

export const usesClickHouse = () => config.eventStore !== 'mongo'

// A typo in the env must stop the process instead of silently running on Mongo
export const validateEventStoreConfig = () => {
  if (eventStores.includes(config.eventStore) === false) {
    throw new Error(`Unknown ACKEE_EVENT_STORE '${config.eventStore}', expected one of: ${eventStores.join(', ')}`)
  }

  if (usesClickHouse() === true && config.clickhouseUrl == null) {
    throw new Error(`ACKEE_CLICKHOUSE is required when ACKEE_EVENT_STORE is '${config.eventStore}'`)
  }
}

export const usesQueue = () => config.ingestQueue === 'redis'

export const validateIngestQueueConfig = () => {
  if (ingestQueues.includes(config.ingestQueue) === false) {
    throw new Error(`Unknown ACKEE_INGEST_QUEUE '${config.ingestQueue}', expected one of: ${ingestQueues.join(', ')}`)
  }

  if (usesQueue() === true && config.redisUrl == null) {
    throw new Error(`ACKEE_REDIS_URL is required when ACKEE_INGEST_QUEUE is '${config.ingestQueue}'`)
  }
}

export default config
