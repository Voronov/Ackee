import config from './config.js'

/*
 * What a process does, chosen by ACKEE_ROLE (ACKEE-19). The default, all, is every part in
 * one process, as it always was: an existing install changes nothing. The other roles let an
 * administrator scale the tracker's traffic, the reports and the background work apart.
 */
export const ROLE_ALL = 'all'
export const ROLE_API = 'api'
export const ROLE_INGEST = 'ingest'
export const ROLE_WORKER = 'worker'

export const ROLES = [ROLE_ALL, ROLE_API, ROLE_INGEST, ROLE_WORKER]

// Parts: http listens with the Express app; app is the UI, the reports, the pages of email links, the
// live feed, sign-in with Google. tracking: the tracker and the views it sends. jobs: the
// worker of the ingest queue, the rollups and the GA4 sync.
const PARTS = {
  [ROLE_ALL]: { http: true, app: true, tracking: true, jobs: true },
  [ROLE_API]: { http: true, app: true, tracking: true, jobs: false },
  [ROLE_INGEST]: { http: true, app: false, tracking: true, jobs: false },
  [ROLE_WORKER]: { http: false, app: false, tracking: false, jobs: true },
}

export const isRole = (value) => ROLES.includes(value)

// Read when asked, not once: tests switch the role per request
export const serves = (part, role = config.role) => PARTS[role]?.[part] === true
