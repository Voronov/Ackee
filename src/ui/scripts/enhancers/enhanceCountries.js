export default (countries = []) => {
  return countries.map((country) => ({
    text: country.value,
    code: country.code ?? null,
    count: country.count,
    date: country.created == null ? null : new Date(country.created),
  }))
}
