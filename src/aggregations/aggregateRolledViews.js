import aggregateRolledFacts from './aggregateRolledFacts.js'

// The views of aggregateViews, read from rollups. A day without unique views comes back with a count of 0
// instead of not at all, which the report shows the same way.
export default (ids, unique, interval, dateDetails, coverage) => {
  return aggregateRolledFacts(ids, interval, dateDetails, coverage, {
    count: { $sum: unique === true ? '$unique' : '$total' },
  })
}
