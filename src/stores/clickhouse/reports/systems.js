import { SYSTEMS_TYPE_NO_VERSION, SYSTEMS_TYPE_WITH_VERSION } from '../../../constants/systems.js'
import groupedRecords from './groupedRecords.js'

const properties = (type) => {
  if (type === SYSTEMS_TYPE_NO_VERSION) return ['osName']
  if (type === SYSTEMS_TYPE_WITH_VERSION) return ['osName', 'osVersion']
}

const toValue = (type) => (row) => {
  if (type === SYSTEMS_TYPE_NO_VERSION) return `${row.osName}`
  if (type === SYSTEMS_TYPE_WITH_VERSION) return `${row.osName} ${row.osVersion}`
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
