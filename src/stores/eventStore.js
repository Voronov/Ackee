/**
 * Storage of visit records and event actions. Metadata (domains, events, tokens,
 * permanentTokens) is not part of this interface and always lives in MongoDB.
 * Signatures mirror the functions in `src/database/*.js` one to one.
 *
 * @typedef {object} EventStore
 * @property {(data: object) => Promise<object>} addRecord Creates a record (`records.add`); `id`, `created` and `updated` in `data` are kept when present.
 * @property {(id: string, updated?: number) => Promise<object | null>} touchRecord Bumps `updated` of a record to `updated` or now, null when unknown (`records.update`).
 * @property {(id: string) => Promise<unknown>} mirrorRecord Pushes the MongoDB state of a record to the secondary store as a new version, no-op without one; repairs a redelivered create whose first delivery reached MongoDB only.
 * @property {(clientId: string, ignoreId: string) => Promise<unknown>} anonymize Nulls the identifying fields of a visitor's earlier records (`records.anonymize`).
 * @property {(domainId: string) => Promise<unknown>} deleteRecords Deletes every record of a domain (`records.del`).
 * @property {(data: object) => Promise<object>} addAction Creates an action (`actions.add`).
 * @property {(id: string, data: object) => Promise<object | null>} touchAction Updates key, value, details and `updated` (`data.updated` or now) of an action, null when unknown (`actions.update`).
 * @property {(id: string) => Promise<unknown>} mirrorAction Same as `mirrorRecord` for an action.
 * @property {(eventId: string) => Promise<unknown>} deleteActions Deletes every action of an event (`actions.del`).
 * @property {(ids: string[], type: string, interval: string, limit: number, dateDetails: object) => Promise<object[]>} views Views per interval, one entry per step (`views`).
 * @property {(ids: string[], sorting: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} pages Pages report (`pages`).
 * @property {(ids: string[], sorting: string, type: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} referrers Referrers report (`referrers`).
 * @property {(ids: string[], interval: string, limit: number, dateDetails: object) => Promise<object[]>} durations Average duration per interval, one entry per step (`durations`).
 * @property {(ids: string[], sorting: string, type: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} systems Systems report (`systems`).
 * @property {(ids: string[], sorting: string, type: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} devices Devices report (`devices`).
 * @property {(ids: string[], sorting: string, type: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} browsers Browsers report (`browsers`).
 * @property {(ids: string[], sorting: string, type: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} sizes Sizes report (`sizes`).
 * @property {(ids: string[], sorting: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} languages Languages report (`languages`).
 * @property {(ids: string[], sorting: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} countries Countries report, each entry carrying the ISO code as `code` (`countries`).
 * @property {(ids: string[], dateDetails: object) => Promise<number>} activeVisitors Number of visitors active right now (`facts`).
 * @property {(ids: string[], type: string, interval: string, limit: number, dateDetails: object) => Promise<object[]>} actionsChart Actions per interval, one entry per step (`actions.getChart`).
 * @property {(ids: string[], sorting: string, type: string, range: string, limit: number, dateDetails: object) => Promise<object[]>} actionsList Actions report (`actions.getList`).
 */

export const writeMethods = [
  'addRecord',
  'touchRecord',
  'mirrorRecord',
  'anonymize',
  'deleteRecords',
  'addAction',
  'touchAction',
  'mirrorAction',
  'deleteActions',
]

export const readMethods = [
  'views',
  'pages',
  'referrers',
  'durations',
  'systems',
  'devices',
  'browsers',
  'sizes',
  'languages',
  'countries',
  'activeVisitors',
  'actionsChart',
  'actionsList',
]

export const methods = [...writeMethods, ...readMethods]
