export default (countries = []) => {
  return countries.map((country) => ({
    text: country.value,
    code: country.code ?? null,
    count: country.count,
    // What a click on the entry filters the reports by (ACKEE-24)
    filter: country.filter ?? null,
    date: country.created == null ? null : new Date(country.created),
  }))
}
