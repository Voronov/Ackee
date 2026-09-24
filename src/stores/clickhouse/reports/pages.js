import groupedRecords from './groupedRecords.js'

export default (ids, sorting, range, limit, dateDetails) =>
  groupedRecords({
    ids,
    sorting,
    range,
    limit,
    dateDetails,
    properties: ['siteLocation'],
    toValue: (row) => row.siteLocation,
    idParts: [sorting, range, ...ids],
  })
