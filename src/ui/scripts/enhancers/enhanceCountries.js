export default (countries = []) => {
  return countries.map((country) => ({
    text: country.value,
    count: country.count,
    date: country.created == null ? null : new Date(country.created),
  }))
}
