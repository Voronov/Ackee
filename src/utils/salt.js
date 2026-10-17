import { createClient } from '@redis/client'
import { format } from 'date-fns'
import schedule from 'node-schedule'
import crypto from 'node:crypto'

import config from './config.js'
import signale from './signale.js'

const generate = () => crypto.randomBytes(16).toString('hex')
let salt = generate()

// Generate a new salt every day
export const rule = new schedule.RecurrenceRule()
rule.hour = 0
// Without a minute the rule fires every minute of that hour
rule.minute = 0

export const job = schedule.scheduleJob(rule, () => (salt = generate()))

// A day and an hour: a process whose clock is a little behind still finds the salt of its day.
// After that the salt is gone from Redis as well.
const sharedTtl = 25 * 60 * 60

// Every process asks Redis for the salt of the current day. The first one stores it, the others
// read it, so all of them compute the same clientId for the same visitor.
export const createSharedSalt = (client, now = () => new Date()) => {
  let cached = {}

  return async () => {
    const key = `ackee:salt:${format(now(), 'yyyy-MM-dd')}`
    if (cached.key === key) return cached.value

    await client.set(key, generate(), { condition: 'NX', expiration: { type: 'EX', value: sharedTtl } })
    cached = { key, value: await client.get(key) }

    return cached.value
  }
}

let sharedSalt
let sharedClient

const connectSharedSalt = async (url) => {
  sharedClient = createClient({ url })
  // Without a listener a lost connection would crash the process
  sharedClient.on('error', (error) => signale.warn(`Redis: ${error.message}`))
  await sharedClient.connect()
  return createSharedSalt(sharedClient)
}

// The open connection keeps the process alive, like the job above
export const closeSharedSalt = async () => {
  await sharedClient?.quit()
  sharedClient = undefined
  sharedSalt = undefined
}

export default async () => {
  if (config.redisUrl == null) return salt

  sharedSalt ??= connectSharedSalt(config.redisUrl).catch((error) => {
    sharedSalt = undefined
    throw error
  })

  return (await sharedSalt)()
}
