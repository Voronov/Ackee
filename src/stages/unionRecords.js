import Record from '../models/Record.js'
import matchDomains from './matchDomains.js'

export default (ids, coverage, project) => {
  // Adds the records the rollups do not cover: the part of the window before the first whole
  // hour, and everything since the rollups were last built.
  const match = matchDomains(ids)

  const head = coverage.start == null ? { $lt: coverage.from } : { $gte: coverage.start, $lt: coverage.from }

  match.$match.$or = [{ created: head }, { created: { $gte: coverage.until } }]

  return {
    $unionWith: {
      coll: Record.collection.collectionName,
      pipeline: [match, project],
    },
  }
}
