import config from '../utils/config.js'
import {
  actionsChart,
  actionsList,
  activeVisitors,
  browsers,
  countries,
  devices,
  durations,
  languages,
  pages,
  referrers,
  sizes,
  systems,
  views,
} from './clickhouse/index.js'
import * as dual from './dual/index.js'
import * as mongo from './mongo/index.js'

// Writes go to both stores in dual and clickhouse alike, only the reads move
const clickhouseStore = {
  ...dual,
  views,
  pages,
  referrers,
  durations,
  systems,
  devices,
  browsers,
  sizes,
  languages,
  countries,
  activeVisitors,
  actionsChart,
  actionsList,
}

/** @returns {import('./eventStore.js').EventStore} The store for the configured `ACKEE_EVENT_STORE`. */
export const getEventStore = () => {
  if (config.eventStore === 'mongo') return mongo
  if (config.eventStore === 'dual') return dual

  return clickhouseStore
}
