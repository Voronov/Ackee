import schedule from 'node-schedule'

import * as connections from '../database/gaConnections.js'
import * as domains from '../database/domains.js'
import Record from '../models/Record.js'
import { getEventStore } from '../stores/index.js'
import { day } from '../utils/times.js'
import signale from '../utils/signale.js'
import { fetchDay } from './ga4Api.js'

// How far back a new connection reaches on its first run. Analytics keeps more than this,
// but a first sync that pulls years would run for hours and surprise whoever set it up.
const FIRST_RUN_DAYS = 30

// Analytics finishes counting a day some hours after it ends, so yesterday is the newest
// day worth asking for.
const newestCompleteDay = () => {
  const date = new Date()

  date.setUTCHours(0, 0, 0, 0)

  return new Date(date.getTime() - day)
}

const originFor = (domain) => (domain.title.includes('.') === true ? `https://${domain.title}` : null)

export const syncConnection = async (entry) => {
  const domain = await domains.getUnscoped(entry.domainId)

  if (domain == null) return { days: 0, records: 0 }

  const origin = originFor(domain)

  if (origin == null) {
    await connections.markFailed(entry.id, `Cannot derive a site address from the domain title "${domain.title}"`)

    return { days: 0, records: 0 }
  }

  const newest = newestCompleteDay()
  const start =
    entry.syncedUntil == null
      ? new Date(newest.getTime() - FIRST_RUN_DAYS * day)
      : new Date(entry.syncedUntil.getTime() + day)

  const credentials = connections.credentialsOf(entry)
  let days = 0
  let records = 0

  for (let date = start; date <= newest; date = new Date(date.getTime() + day)) {
    const batch = await fetchDay({ credentials, propertyId: entry.propertyId, date, domainId: domain.id, origin })

    if (batch.length > 0) {
      await Record.insertMany(batch, { ordered: false })
      await getEventStore().mirrorRecords(batch)
    }

    // Marked after each day, so an interrupted run resumes instead of starting over or
    // importing a day twice.
    await connections.markSynced(entry.id, date)

    days++
    records += batch.length
  }

  return { days, records }
}

export const syncAll = async () => {
  for (const entry of await connections.all()) {
    try {
      const { days, records } = await syncConnection(entry)

      if (days > 0) signale.info(`Analytics sync: ${records} records over ${days} days for ${entry.domainId}`)
    } catch (error) {
      // One broken connection must not stop the others: a revoked key is the user's
      // problem to fix, and they see it in the domain settings.
      signale.fatal(`Analytics sync failed for ${entry.domainId}: ${error.message}`)
      await connections.markFailed(entry.id, error.message)
    }
  }
}

export const start = () => {
  // Once a day, after Analytics has finished counting the previous one.
  const job = schedule.scheduleJob('30 4 * * *', () => {
    syncAll().catch(signale.fatal)
  })

  signale.info('Analytics sync enabled')

  return job
}
