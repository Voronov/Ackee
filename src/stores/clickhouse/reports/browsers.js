import { BROWSERS_TYPE_NO_VERSION, BROWSERS_TYPE_WITH_VERSION } from '../../../constants/browsers.js'
import groupedRecords from './groupedRecords.js'

const properties = (type) => {
  if (type === BROWSERS_TYPE_NO_VERSION) return ['browserName']
  if (type === BROWSERS_TYPE_WITH_VERSION) return ['browserName', 'browserVersion']
}

const toValue = (type) => (row) => {
  if (type === BROWSERS_TYPE_NO_VERSION) return `${row.browserName}`
  if (type === BROWSERS_TYPE_WITH_VERSION) return `${row.browserName} ${row.browserVersion}`
}

export default (ids, sorting, type, range, limit, dateDetails) =>
  groupedRecords({
    ids,
    sorting,
    range,
    limit,
    dateDetails,
    properties: properties(type),
    toValue: toValue(type),
    idParts: [sorting, type, range, ...ids],
  })
