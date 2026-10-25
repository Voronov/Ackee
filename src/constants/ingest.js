import { minute, second } from '../utils/times.js'

export const INGEST_STREAM = 'ackee:ingest'
export const INGEST_GROUP = 'ackee-ingest'

// Bumped when the message layout changes, so a worker never guesses at a message it does not know
export const INGEST_VERSION = '1'

export const RECORD_CREATE = 'record.create'
export const RECORD_TOUCH = 'record.touch'

export const INGEST_BATCH_SIZE = 200
export const INGEST_BLOCK = 1000

// A message read by a consumer that died is handed to another one after this
export const INGEST_MIN_IDLE = 60 * second

// How long the worker waits after MongoDB or Redis failed, before it tries the same messages again
export const INGEST_RETRY_DELAY = 5 * second

// The delivery on which a touch without its record is dropped. Its create is earlier in the
// stream, so it is overtaken only while stuck with a dead consumer; XAUTOCLAIM hands both back
// after INGEST_MIN_IDLE in id order, the create first. The third is a spare for more consumers
// (ACKEE-19). A touch of a made-up id stays in Redis about 2 minutes.
export const INGEST_MAX_DELIVERIES = 3

// Domains on the ingest path are read from a cache, so a heavy report cannot slow the tracker down
export const INGEST_DOMAIN_TTL = 30 * second

// The tracker waits for the queue at most this long before the event is written directly.
// Also the deadline of the reads for /metrics and the rollups, the whole call included.
export const INGEST_ENQUEUE_TIMEOUT = 1000

// A consumer that has not shown up for this long and holds nothing is gone: its process was
// replaced by one with another name. A live consumer comes back at least every INGEST_BLOCK.
export const INGEST_CONSUMER_TTL = 60 * minute
export const INGEST_CLEANUP_INTERVAL = 10 * minute

// Why an event was written directly, the label of ackee_ingest_fallback_total
export const FALLBACK_UNAVAILABLE = 'unavailable'
export const FALLBACK_FULL = 'full'

// Why a message was given up on, the label of ackee_ingest_queue_dropped_total
export const DROP_MALFORMED = 'malformed'
export const DROP_UNKNOWN_VERSION = 'unknown_version'
export const DROP_UNKNOWN_TYPE = 'unknown_type'
export const DROP_INVALID = 'invalid'
export const DROP_UNKNOWN_DOMAIN = 'unknown_domain'
export const DROP_UNKNOWN_RECORD = 'unknown_record'
