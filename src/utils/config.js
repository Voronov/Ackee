import { day } from './times.js'

// Must be a function or object that loads and returns the env variables at runtime.
// Otherwise it wouldn't be possible to mock the env variables with mockedEnv.
export default new Proxy(
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
        clickhouseUrl: process.env.ACKEE_CLICKHOUSE,
        clickhouseUser: process.env.ACKEE_CLICKHOUSE_USER || 'default',
        clickhousePassword: process.env.ACKEE_CLICKHOUSE_PASSWORD || '',
        clickhouseDatabase: process.env.ACKEE_CLICKHOUSE_DATABASE || 'ackee',
        // Reads are switched on separately from writes: data first accumulates through
        // dual-write, and only then do reports start using it.
        clickhouseReads: process.env.ACKEE_CLICKHOUSE_READS === 'true',
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
