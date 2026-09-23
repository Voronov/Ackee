import languageCodes from '../../../utils/languageCodes.js'
import groupedRecords from './groupedRecords.js'

export default (ids, sorting, range, limit, dateDetails) =>
  groupedRecords({
    ids,
    sorting,
    range,
    limit,
    dateDetails,
    properties: ['siteLanguage'],
    toValue: (row) => languageCodes[row.siteLanguage] || row.siteLanguage,
    idParts: [sorting, range, ...ids],
  })
