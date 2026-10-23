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
        redisUrl: process.env.ACKEE_REDIS,
        // Redis of the ingest queue (ADR-006). Empty counts as unset, so a blank line in an
        // env file keeps the queue off.
        ingestQueue: process.env.ACKEE_INGEST_QUEUE || undefined,
        // Name of this process in the consumer group of the queue, the host name when unset
        ingestConsumer: process.env.ACKEE_INGEST_CONSUMER || undefined,
        allowOrigin: process.env.ACKEE_ALLOW_ORIGIN,
        autoOrigin: process.env.ACKEE_AUTO_ORIGIN === 'true',
        username: process.env.ACKEE_USERNAME,
        password: process.env.ACKEE_PASSWORD,
        // Closed unless switched on, so an update never opens an install to strangers (ADR-002).
        allowSignup: process.env.ACKEE_ALLOW_SIGNUP === 'true',
        // Which build this is: a version tag or sha-<commit>, set by CI when the image is built.
        build: process.env.ACKEE_BUILD || 'local',
        // Public address of this instance. Used to build the links inside emails, so a
        // wrong value produces links that go nowhere.
        publicUrl: process.env.ACKEE_URL,
        smtpHost: process.env.ACKEE_SMTP_HOST,
        smtpPort: Number(process.env.ACKEE_SMTP_PORT || 465),
        smtpUser: process.env.ACKEE_SMTP_USER,
        smtpPassword: process.env.ACKEE_SMTP_PASSWORD,
        smtpFrom: process.env.ACKEE_SMTP_FROM || process.env.ACKEE_SMTP_USER,
        metricsToken: process.env.ACKEE_METRICS_TOKEN,
        // Sign-in with Google (ACKEE-79). Off unless both are set, and ACKEE_URL too.
        googleClientId: process.env.ACKEE_GOOGLE_CLIENT_ID,
        googleClientSecret: process.env.ACKEE_GOOGLE_CLIENT_SECRET,
        // Google's endpoints. Only tests point them elsewhere, at a stand-in for Google.
        googleAuthUrl: process.env.ACKEE_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
        googleTokenUrl: process.env.ACKEE_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
        isDemoMode: process.env.ACKEE_DEMO === 'true',
        isDevelopmentMode: process.env.NODE_ENV === 'development',
        isPreBuildMode: process.env.BUILD_ENV === 'pre',
      }

      return data[property]
    },
  },
)
