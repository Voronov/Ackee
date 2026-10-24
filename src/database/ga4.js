import { toZonedTime } from 'date-fns-tz'

import { INTERVALS_DAILY, INTERVALS_MONTHLY } from '../constants/intervals.js'
import {
  RANGES_LAST_24_HOURS,
  RANGES_LAST_30_DAYS,
  RANGES_LAST_6_MONTHS,
  RANGES_LAST_7_DAYS,
} from '../constants/ranges.js'
import { SORTINGS_TOP } from '../constants/sortings.js'
import { VIEWS_TYPE_UNIQUE } from '../constants/views.js'
import { runReport } from '../ga4/api.js'
import Ga4Connection from '../models/Ga4Connection.js'
import Ga4Daily from '../models/Ga4Daily.js'
import createArray from '../utils/createArray.js'
import recursiveId from '../utils/recursiveId.js'
import { open, seal } from '../utils/secretBox.js'

/*
 * GA4 next to Ackee (ACKEE-21): the connection of a domain, and reports from the synced days in
 * the same shape as Ackee's own, so the interface shows either without knowing which.
 */
const response = (entry) =>
  entry == null
    ? null
    : {
        propertyId: entry.propertyId,
        clientEmail: entry.clientEmail,
        firstDate: entry.firstDate ?? null,
        lastDate: entry.lastDate ?? null,
        lastSync: entry.lastSync ?? null,
        lastError: entry.lastError ?? null,
        syncing: entry.lockedUntil != null && entry.lockedUntil > new Date(),
      }

export const get = async (domainId) => response(await Ga4Connection.findOne({ domainId }).lean())

// The service account key as Google hands it out: a JSON file with client_email and private_key
export const parseKey = (text) => {
  let key
  try {
    key = JSON.parse(text)
  } catch {
    return null
  }

  if (key?.type !== 'service_account' || typeof key.client_email !== 'string' || typeof key.private_key !== 'string')
    return null

  return { clientEmail: key.client_email, privateKey: key.private_key }
}

// Reads a week of views once, so a wrong id or a missing permission shows before anything is
// stored. Always with a token bought by this very key: the check is what proves the key.
export const check = (account, propertyId) =>
  runReport(
    account,
    propertyId,
    { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'screenPageViews' }] },
    { fresh: true },
  )

export const connect = async (domainId, propertyId, account) => {
  await Ga4Daily.deleteMany({ domainId })
  const entry = await Ga4Connection.findOneAndUpdate(
    { domainId },
    {
      $set: { propertyId, clientEmail: account.clientEmail, privateKey: seal(account.privateKey) },
      $unset: { firstDate: 1, lastDate: 1, lastSync: 1, lastError: 1, lockedUntil: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )

  return entry
}

// Forgets the property and every day synced from it
export const disconnect = async (domainId) => {
  await Ga4Connection.deleteOne({ domainId })
  await Ga4Daily.deleteMany({ domainId })
}

export const account = (entry) => ({ clientEmail: entry.clientEmail, privateKey: open(entry.privateKey) })

const isoDay = (date) => date.toISOString().slice(0, 10)

// The period of a date as the start of a YYYY-MM-DD string, and as Ackee labels it
const period = (date, interval) => {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')

  if (interval === INTERVALS_DAILY)
    return { prefix: `${year}-${month}-${dayOfMonth}`, value: `${year}-${date.getMonth() + 1}-${date.getDate()}` }
  if (interval === INTERVALS_MONTHLY) return { prefix: `${year}-${month}`, value: `${year}-${date.getMonth() + 1}` }
  return { prefix: year, value: year }
}

// The synced days of each period that a report shows, newest first
const periods = async (ids, interval, limit, dateDetails) => {
  const since = isoDay(dateDetails.includeFnByInterval(interval)(limit))
  const days = await Ga4Daily.find({ domainId: { $in: ids }, dimension: 'total', date: { $gte: since } }).lean()

  return createArray(limit).map((_, index) => {
    const { prefix, value } = period(
      toZonedTime(dateDetails.lastFnByInterval(interval)(index), dateDetails.userTimeZone),
      interval,
    )
    return { value, days: days.filter((entry) => entry.date.startsWith(prefix)) }
  })
}

const sum = (days, field) => days.reduce((total, entry) => total + (entry[field] ?? 0), 0)

// Views or users per day, month or year, like database/views.js. Users of several days add up,
// which counts someone who came back twice: GA4 does not tell more from daily numbers.
export const views = async (ids, type, interval, limit, dateDetails) => {
  const field = type === VIEWS_TYPE_UNIQUE ? 'users' : 'views'

  return (await periods(ids, interval, limit, dateDetails)).map(({ value, days }) => ({
    id: recursiveId([value, 'GA4', type, ...ids]),
    value,
    count: sum(days, field),
  }))
}

// The average session duration in milliseconds, weighted by sessions, like database/durations.js
export const durations = async (ids, interval, limit, dateDetails) =>
  (await periods(ids, interval, limit, dateDetails)).map(({ value, days }) => {
    const sessions = sum(days, 'sessions')
    return {
      id: recursiveId([value, 'GA4-durations', ...ids]),
      value,
      count: sessions === 0 ? 0 : Math.round((sum(days, 'durationSum') / sessions) * 1000),
    }
  })

const startOfRange = (range, dateDetails) => {
  if (range === RANGES_LAST_24_HOURS) return dateDetails.lastHours(24)
  if (range === RANGES_LAST_7_DAYS) return dateDetails.lastDays(7)
  if (range === RANGES_LAST_30_DAYS) return dateDetails.lastDays(30)
  if (range === RANGES_LAST_6_MONTHS) return dateDetails.lastMonths(6)
}

// A top list of one GA4 dimension. GA4 has no order by first or last visit, so NEW and RECENT
// are empty for it.
export const list =
  (dimension, format = (value) => value) =>
  async (ids, sorting, type, range, limit, dateDetails) => {
    if (sorting !== SORTINGS_TOP) return []

    const start = startOfRange(range, dateDetails)
    const match = { domainId: { $in: ids }, dimension, ...(start == null ? {} : { date: { $gte: isoDay(start) } }) }
    const entries = await Ga4Daily.aggregate([
      { $match: match },
      { $group: { _id: '$value', count: { $sum: '$views' } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ])

    return entries.map((entry) => {
      const value = format(entry._id)
      return {
        id: recursiveId([value, 'GA4', sorting, type, range, ...ids].filter((part) => part != null)),
        value,
        count: entry.count,
        created: null,
      }
    })
  }

// GA4 gives "example.com/page" without a scheme; Ackee's page lists show addresses
export const pageUrl = (value) => (/^https?:\/\//.test(value) ? value : `https://${value}`)
