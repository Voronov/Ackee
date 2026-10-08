import Record from '../models/Record.js'
import Rollup from '../models/Rollup.js'
import { hashKey, keyOf, nameOf } from './dimension.js'
import registry from './registry.js'

// The same presence rule as in aggregateTopRecords: either every field of the dimension
// is set, or, with `or`, at least one of them.
const presence = ({ properties, or = false }) =>
  or === true
    ? { $or: properties.map((property) => ({ [property]: { $ne: null } })) }
    : Object.fromEntries(properties.map((property) => [property, { $ne: null }]))

const facetFor = (dimension) => [
  { $match: presence(dimension) },
  {
    $group: {
      _id: {
        bucket: { $dateTrunc: { date: '$created', unit: 'hour' } },
        ...Object.fromEntries(dimension.properties.map((property) => [property, `$${property}`])),
      },
      count: { $sum: 1 },
    },
  },
]

// Rebuilds one domain's rollups for the range [from, to).
//
// Existing buckets in the range are deleted first and the new ones inserted, so the call
// is idempotent and leaves nothing behind from records that are gone. The incremental run
// covers two hours, so deleting is cheap.
//
// One `$facet` computes every dimension in a single pass. Separate aggregations would mean
// as many scans of the collection as there are dimensions.
export const buildRange = async (domainId, from, to) => {
  const [facets] = await Record.aggregate([
    { $match: { domainId, created: { $gte: from, $lt: to } } },
    { $facet: Object.fromEntries(registry.map((dimension, index) => [`d${index}`, facetFor(dimension)])) },
  ]).allowDiskUse(true)

  const documents = []

  for (const [index, dimension] of registry.entries()) {
    const name = nameOf(dimension)

    for (const entry of facets[`d${index}`] ?? []) {
      const key = keyOf(dimension.properties, entry._id)

      documents.push({
        domainId,
        dimension: name,
        keyHash: hashKey(key),
        key,
        bucket: entry._id.bucket,
        count: entry.count,
      })
    }
  }

  await Rollup.deleteMany({ domainId, bucket: { $gte: from, $lt: to } })
  if (documents.length > 0) await Rollup.insertMany(documents, { ordered: false })

  return documents.length
}
