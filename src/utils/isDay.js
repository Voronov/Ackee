const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// A real day of the calendar as YYYY-MM-DD. Date.parse rolls 02-31 over to March in V8 only.
export default (value) => {
  const [, year, month, day] = (DAY.exec(value) ?? []).map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]

  return year > 0 && day > 0 && day <= days
}
