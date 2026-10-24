import schedule from 'node-schedule'

import { GA4_BACKFILL_DAYS, GA4_CHUNK_DAYS, GA4_DIMENSIONS, GA4_REFRESH_DAYS } from '../constants/ga4.js'
import Ga4Connection from '../models/Ga4Connection.js'
import Ga4Daily from '../models/Ga4Daily.js'
import { open } from '../utils/secretBox.js'
import signale from '../utils/signale.js'
import { day, minute } from '../utils/times.js'
import { runReport } from './api.js'

const isoDay = (date) => date.toISOString().slice(0, 10)
const fromGa = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`

// One range of days: totals and one list per dimension, all replaced at once so syncing the
// same days again changes nothing
const syncRange = async (connection, account, startDate, endDate) => {
  const dateRanges = [{ startDate, endDate }]
  const documents = []

  const totals = await runReport(account, connection.propertyId, {
    dateRanges,
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'averageSessionDuration' },
    ],
  })
  for (const { dimensions, metrics } of totals) {
    const [views, users, sessions, average] = metrics
    documents.push({
      domainId: connection.domainId,
      date: fromGa(dimensions[0]),
      dimension: 'total',
      views,
      users,
      sessions,
      durationSum: average * sessions,
    })
  }

  for (const [key, name] of Object.entries(GA4_DIMENSIONS)) {
    const rows = await runReport(account, connection.propertyId, {
      dateRanges,
      dimensions: [{ name: 'date' }, { name }],
      metrics: [{ name: 'screenPageViews' }],
    })
    for (const { dimensions, metrics } of rows) {
      documents.push({
        domainId: connection.domainId,
        date: fromGa(dimensions[0]),
        dimension: key,
        value: dimensions[1],
        views: metrics[0],
      })
    }
  }

  await Ga4Daily.deleteMany({ domainId: connection.domainId, date: { $gte: startDate, $lte: endDate } })
  if (documents.length > 0) await Ga4Daily.insertMany(documents, { ordered: false })
}

/*
 * Brings one connection up to date: the whole backfill the first time, then the last days
 * again, because GA4 keeps counting them for a while. Chunks keep a long backfill resumable.
 */
export const syncConnection = async (connection, now = new Date()) => {
  const leased = await Ga4Connection.findOneAndUpdate(
    { _id: connection._id, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + 30 * minute) } },
    { returnDocument: 'after' },
  )
  if (leased == null) return

  const account = { clientEmail: leased.clientEmail, privateKey: open(leased.privateKey) }
  const today = isoDay(now)
  const start =
    leased.lastDate == null
      ? isoDay(new Date(now.getTime() - GA4_BACKFILL_DAYS * day))
      : isoDay(new Date(Math.min(new Date(leased.lastDate).getTime(), now.getTime()) - GA4_REFRESH_DAYS * day))

  try {
    for (let from = new Date(start); isoDay(from) <= today; from = new Date(from.getTime() + GA4_CHUNK_DAYS * day)) {
      const to = new Date(Math.min(from.getTime() + (GA4_CHUNK_DAYS - 1) * day, new Date(today).getTime()))
      await syncRange(leased, account, isoDay(from), isoDay(to))
      await Ga4Connection.updateOne(
        { _id: leased._id },
        {
          $set: {
            firstDate: leased.firstDate ?? start,
            lastDate: isoDay(to),
            lockedUntil: new Date(Date.now() + 30 * minute),
          },
        },
      )
    }
    await Ga4Connection.updateOne({ _id: leased._id }, { $set: { lastSync: now, lastError: null, lockedUntil: null } })
  } catch (error) {
    await Ga4Connection.updateOne({ _id: leased._id }, { $set: { lastError: error.message, lockedUntil: null } })
    throw error
  }
}

export const syncAll = async () => {
  for (const connection of await Ga4Connection.find({})) {
    try {
      await syncConnection(connection)
    } catch (error) {
      // One broken connection must not stop the others; the domain dialog shows the error
      signale.warn(`GA4 sync of domain ${connection.domainId} failed: ${error.message}`)
    }
  }
}

// At start and every three hours
export const start = () => {
  syncAll()
  return schedule.scheduleJob('15 */3 * * *', syncAll)
}
