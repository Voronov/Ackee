import { DEVICES_TYPE_NO_MODEL, DEVICES_TYPE_WITH_MODEL } from '../../../constants/devices.js'
import groupedRecords from './groupedRecords.js'

const properties = (type) => {
  if (type === DEVICES_TYPE_NO_MODEL) return ['deviceManufacturer']
  if (type === DEVICES_TYPE_WITH_MODEL) return ['deviceManufacturer', 'deviceName']
}

const toValue = (type) => (row) => {
  if (type === DEVICES_TYPE_NO_MODEL) return `${row.deviceManufacturer}`
  if (type === DEVICES_TYPE_WITH_MODEL) return `${row.deviceManufacturer} ${row.deviceName}`
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
