import groupedRecords from './groupedRecords.js'

// Country names in English, like the rest of the interface. No lookup table: Intl knows
// them all and updates with Node.
const names = new Intl.DisplayNames(['en'], { type: 'region' })

const nameOf = (code) => {
  try {
    return names.of(code) ?? code
  } catch {
    // A code Intl does not know, such as a retired one, is shown as it is.
    return code
  }
}

export default (ids, sorting, range, limit, dateDetails) =>
  groupedRecords({
    ids,
    sorting,
    range,
    limit,
    dateDetails,
    properties: ['country'],
    toValue: (row) => nameOf(row.country),
    // The interface needs the code for maps and flags; a name will not do.
    toExtra: (row) => ({ code: row.country }),
    idParts: [sorting, range, ...ids],
  })
