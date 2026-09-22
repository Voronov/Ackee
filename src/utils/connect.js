import mongoose from 'mongoose'

import { instrumentMongo } from './metrics.js'

export default async (dbUrl) => {
  const connection = await mongoose.connect(dbUrl, {
    connectTimeoutMS: 60000,
    // Needed for metrics: without it the driver emits no command events.
    monitorCommands: true,
  })

  instrumentMongo(connection.connection.getClient())

  return connection
}
