import {
  REFERRERS_TYPE_NO_SOURCE,
  REFERRERS_TYPE_ONLY_SOURCE,
  REFERRERS_TYPE_WITH_SOURCE,
} from '../../../constants/referrers.js'
import groupedRecords from './groupedRecords.js'

const properties = (type) => {
  if (type === REFERRERS_TYPE_WITH_SOURCE) return ['source', 'siteReferrer']
  if (type === REFERRERS_TYPE_NO_SOURCE) return ['siteReferrer']
  if (type === REFERRERS_TYPE_ONLY_SOURCE) return ['source']
}

export default (ids, sorting, type, range, limit, dateDetails) =>
  groupedRecords({
    ids,
    sorting,
    range,
    limit,
    dateDetails,
    properties: properties(type),
    either: type === REFERRERS_TYPE_WITH_SOURCE,
    toValue: (row) => row.source || row.siteReferrer,
    idParts: [sorting, type, range, ...ids],
  })
