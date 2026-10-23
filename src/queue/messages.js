import {
  DROP_MALFORMED,
  DROP_UNKNOWN_TYPE,
  DROP_UNKNOWN_VERSION,
  INGEST_VERSION,
  RECORD_CREATE,
  RECORD_TOUCH,
} from '../constants/ingest.js'

// A message that no retry can write. The worker logs it, counts it by reason and lets it go.
export class PoisonError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'PoisonError'
    this.reason = reason
  }
}

const types = new Set([RECORD_CREATE, RECORD_TOUCH])

const time = (date) => new Date(date).getTime()

// Redis keeps strings only. Dates travel as milliseconds, `at` is when the API took the event.
const encode = (type, at, data) => ({ v: INGEST_VERSION, type, at: String(at), data: JSON.stringify(data) })

// The record as it will be stored, with the id and the dates the tracker was already told.
// It holds the clientId but never the IP or the user agent the clientId was made from.
export const recordCreate = (data) => {
  const created = time(data.created)
  return encode(RECORD_CREATE, created, { ...data, created, updated: time(data.updated) })
}

export const recordTouch = (id, updated) => encode(RECORD_TOUCH, time(updated), { id, updated: time(updated) })

const parse = (json) => {
  try {
    return JSON.parse(json)
  } catch {
    return
  }
}

// Turns a stream entry into { id, type, at, data } or throws a PoisonError
export const decode = ({ id, fields }) => {
  if (fields?.v == null) throw new PoisonError(DROP_MALFORMED, `Message ${id} has no version`)
  if (fields.v !== INGEST_VERSION) throw new PoisonError(DROP_UNKNOWN_VERSION, `Unknown version '${fields.v}'`)
  if (types.has(fields.type) === false) throw new PoisonError(DROP_UNKNOWN_TYPE, `Unknown type '${fields.type}'`)

  const at = Number(fields.at)
  const data = parse(fields.data)

  if (Number.isFinite(at) === false) throw new PoisonError(DROP_MALFORMED, `Message ${id} has no time`)
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new PoisonError(DROP_MALFORMED, `Message ${id} carries no data`)
  }
  // Without an id a create would store a new record on every delivery, and a touch with
  // an undefined filter would match whatever record comes first
  if (typeof data.id !== 'string' || data.id === '') throw new PoisonError(DROP_MALFORMED, `Message ${id} has no id`)

  // The dates are those the tracker was told. Left to the worker, they would be the time of
  // the write or the defaults of the model.
  const dates = fields.type === RECORD_CREATE ? [data.created, data.updated] : [data.updated]
  if (dates.every((date) => Number.isFinite(date)) === false) {
    throw new PoisonError(DROP_MALFORMED, `Message ${id} has no valid dates`)
  }

  return { id, type: fields.type, at: new Date(at), data }
}
