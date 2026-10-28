import dimension from './dimension.js'

// Names in English, from the ICU data of Node. An unknown code is shown as it is.
const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })

export const countryName = (code) => {
  try {
    return names.of(code)
  } catch {
    return code
  }
}

// One type only: there is nothing to a country beyond its code. The constant name keeps the
// ids of the entries stable, see database/dimension.js.
const COUNTRIES_TYPE = 'COUNTRY'

const get = dimension(
  {
    [COUNTRIES_TYPE]: {
      fields: ['country'],
      format: (id) => countryName(id.country),
    },
  },
  'countries',
)

export default (ids, sorting, range, limit, dateDetails) => get(ids, sorting, COUNTRIES_TYPE, range, limit, dateDetails)
