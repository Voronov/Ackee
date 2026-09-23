import { createHash } from 'node:crypto'

// A dimension is named by its fields and how they combine. `or: true` means a record
// counts when at least one field is set, which is how referrers with a source work.
export const dimensionName = (properties, or = false) => `${properties.join('|')}${or === true ? ':or' : ''}`

// A dimension with no fields (views) has nothing to join into a name, so it carries one.
export const nameOf = (dimension) => dimension.name ?? dimensionName(dimension.properties, dimension.or)

// The group key is serialised in a stable way, so the same group always hashes the same.
export const keyOf = (properties, source) =>
  Object.fromEntries(properties.map((property) => [property, source?.[property] ?? null]))

export const hashKey = (key) =>
  createHash('sha1')
    .update(JSON.stringify(Object.entries(key).toSorted(([left], [right]) => left.localeCompare(right))))
    .digest('hex')

// Bucket boundaries, in UTC.
export const floorHour = (date) => {
  const result = new Date(date)
  result.setUTCMinutes(0, 0, 0)
  return result
}

export const ceilHour = (date) => {
  const floored = floorHour(date)
  return floored.getTime() === new Date(date).getTime() ? floored : new Date(floored.getTime() + 3_600_000)
}

// BSON sort order for the values that appear in dimension keys: null < numbers < strings.
// Reading rollups has to order ties the same way MongoDB does, or the two read paths would
// disagree whenever counts are equal.
const bsonRank = (value) => {
  if (value == null) return 0
  if (typeof value === 'number') return 1
  return 2
}

export const compareValues = (left, right) => {
  const rank = bsonRank(left) - bsonRank(right)
  if (rank !== 0) return rank
  if (left == null) return 0
  if (typeof left === 'number') return left - right

  return String(left).localeCompare(String(right), 'en')
}

// The same order as `$sort: { count: -1, '_id.<field>': 1, … }`.
export const compareEntries = (properties) => (left, right) => {
  if (left.count !== right.count) return right.count - left.count

  for (const property of properties) {
    const result = compareValues(left.key?.[property], right.key?.[property])
    if (result !== 0) return result
  }

  return 0
}
