import flag from '../utils/countryFlag.js'

export default (countries = []) => {
  return countries.map((country) => ({
    // The flag carries no information the name does not, but it makes a long list
    // scannable at a glance.
    text: `${flag(country.code)} ${country.value}`.trim(),
    // The map needs the code, and the name without the flag for its tooltips.
    code: country.code,
    name: country.value,
    count: country.count,
    date: country.created == null ? null : new Date(country.created),
  }))
}
