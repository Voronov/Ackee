import { second } from '../utils/times.js'

export const LIVE_PATH = '/api/live'

// One query per tick for every viewer of the process, see ADR-007. With the queue a view
// reaches MongoDB about a second late, so the worst case stays well below the 10 s of the card.
export const LIVE_POLL_INTERVAL = 2 * second

// How far back each tick looks. Covers the delay of the ingest queue (ADR-006): a view written
// later than this after it happened does not reach the feed, only the reports.
export const LIVE_WINDOW = 15 * second

// Views one tick reads at most, the newest ones. When even the oldest of them is new, older
// new views did not fit and every viewer gets a gap.
export const LIVE_BATCH_SIZE = 200

// Recent visits kept per watched domain. A new viewer gets them at once, without a query.
export const LIVE_BUFFER_SIZE = 20

// What a new stream gets of the buffers at most, the newest views. Matches the rows the UI keeps,
// and keeps the first pack of a stream of many domains within LIVE_MAX_PACK.
export const LIVE_BACKLOG_SIZE = 100

// How long the buffer of a domain outlives its last viewer, so a reconnect can replay it
export const LIVE_BUFFER_GRACE = 60 * second

// Keeps proxies with a read timeout from closing a quiet stream
export const LIVE_HEARTBEAT_INTERVAL = 20 * second

// How often an open stream checks its token and domains again
export const LIVE_RECHECK_INTERVAL = 60 * second

// How long a browser waits before it reconnects, sent as `retry:` on every stream
export const LIVE_RETRY = 5 * second

// A client still this far behind when the next tick writes has not read since the last one.
// It is dropped rather than buffered for, and reconnects on its own.
export const LIVE_MAX_BUFFERED = 64 * 1024

// What one tick or backlog may add on top. A full tick of LIVE_BATCH_SIZE views is about
// 70 KB with usual URLs; this leaves room for long ones and still bounds the memory of a stream.
export const LIVE_MAX_PACK = 1024 * 1024

// Seconds in the Retry-After header of a 429
export const LIVE_RETRY_AFTER = 30

// Defaults of ACKEE_LIVE_CONNECTIONS and ACKEE_LIVE_WORKSPACE_CONNECTIONS, per process
export const LIVE_CONNECTIONS = 100
export const LIVE_WORKSPACE_CONNECTIONS = 20

// Why a stream was refused or ended, the label of ackee_live_rejected_total and the reason of `event: end`
export const LIVE_UNAUTHORIZED = 'unauthorized'
export const LIVE_FORBIDDEN = 'forbidden'
export const LIVE_UNKNOWN_DOMAIN = 'unknown_domain'
export const LIVE_PROCESS_LIMIT = 'process_limit'
export const LIVE_WORKSPACE_LIMIT = 'workspace_limit'

// How a tick went, the label of ackee_live_polls_total
export const LIVE_POLL_OK = 'ok'
export const LIVE_POLL_GAP = 'gap'
export const LIVE_POLL_ERROR = 'error'
