// Interval reports must agree entry for entry. Top reports sort by count alone, so rows
// tied at the cut-off may differ between implementations (D-001 and SEMANTICS.md, "Ties"):
// every row above the lowest count must agree, and so must the multiset of counts.
const plain = (entries) => entries.map(({ id, value, count }) => ({ id, value, count }))

const byValue = (left, right) => String(left.value).localeCompare(String(right.value))

const differences = (expected, actual) => {
  const length = Math.max(expected.length, actual.length)
  const result = []

  for (let index = 0; index < length; index++) {
    if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) {
      result.push({ index, expected: expected[index], actual: actual[index] })
    }
  }

  return result
}

export const compare = (kind, expected, actual) => {
  if (kind === 'interval') return differences(plain(expected), plain(actual))

  const lowest = Math.min(...expected.map((entry) => entry.count))
  const above = (entries) => plain(entries.filter((entry) => entry.count > lowest)).toSorted(byValue)
  const counts = (entries) => entries.map((entry) => ({ count: entry.count })).toSorted((a, b) => b.count - a.count)

  return [...differences(above(expected), above(actual)), ...differences(counts(expected), counts(actual))]
}

export const describeDifferences = (found) =>
  found.length === 0
    ? 'ok'
    : `DIFF ${found.length}: ${found
        .slice(0, 3)
        .map((entry) => `#${entry.index} ${JSON.stringify(entry.expected)} vs ${JSON.stringify(entry.actual)}`)
        .join('; ')}`
