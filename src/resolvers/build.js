import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'

import config from '../utils/config.js'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

export default {
  Query: {
    // No requireAuth and no data: only what runs here and whether the database answers.
    build: () => ({
      id: config.build,
      version,
      database: mongoose.connection.readyState === mongoose.ConnectionStates.connected,
    }),
  },
}
