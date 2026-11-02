import mongoose from 'mongoose'

import { instrumentMongo, isEnabled as metricsEnabled } from './metrics.js'

// Command events cost the driver work on every command, so they are on only with metrics,
// which are the only listener.
export const connectionOptions = () => ({
  connectTimeoutMS: 60000,
  monitorCommands: metricsEnabled(),
})

// `options` override the defaults: the tests of the live feed count the driver's commands
export default async (dbUrl, options = {}) => {
  const connection = await mongoose.connect(dbUrl, { ...connectionOptions(), ...options })

  instrumentMongo(connection.connection.getClient())

  return connection
}
