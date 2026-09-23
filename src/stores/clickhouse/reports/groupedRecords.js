import { SORTINGS_NEW, SORTINGS_RECENT, SORTINGS_TOP } from '../../../constants/sortings.js'
import recursiveId from '../../../utils/recursiveId.js'
import { rangeFilter } from './ranges.js'
import select from './select.js'

// Property names come from the report modules, never from the request
const columns = (properties) => properties.join(', ')

// `$ne: null` in MongoDB drops missing and null fields alike; anonymized versions have
// NULL in every identifying column, so their records vanish from these reports too
const notNull = (properties, either) =>
  properties.map((property) => `${property} IS NOT NULL`).join(either ? ' OR ' : ' AND ')

const top = (ids, properties, either, range, limit, dateDetails) => {
  const { clause, parameters } = rangeFilter(range, dateDetails)

  return select(
    `
      SELECT
        ${columns(properties)},
        count() AS count
      FROM {database:Identifier}.records FINAL
      WHERE domainId IN {ids:Array(String)}
        AND (${notNull(properties, either)})
        ${clause}
      GROUP BY ${columns(properties)}
      ORDER BY count DESC
      LIMIT {limit:UInt64}
    `,
    { ids, limit, ...parameters },
  )
}

// Min(created) is what MongoDB's $first yields after its sort by created
const newest = (ids, properties, either, limit) =>
  select(
    `
      SELECT
        ${columns(properties)},
        count() AS count,
        toUnixTimestamp64Milli(min(created)) AS createdAt
      FROM {database:Identifier}.records FINAL
      WHERE domainId IN {ids:Array(String)}
        AND (${notNull(properties, either)})
      GROUP BY ${columns(properties)}
      ORDER BY createdAt DESC, ${columns(properties)} ASC
      LIMIT {limit:UInt64}
    `,
    { ids, limit },
  )

const recent = (ids, properties, either, limit) =>
  select(
    `
      SELECT
        ${columns(properties)},
        toUnixTimestamp64Milli(created) AS createdAt
      FROM {database:Identifier}.records FINAL
      WHERE domainId IN {ids:Array(String)}
        AND (${notNull(properties, either)})
      ORDER BY createdAt DESC
      LIMIT {limit:UInt64}
    `,
    { ids, limit },
  )

const rows = ({ ids, sorting, range, limit, dateDetails, properties, either }) => {
  if (sorting === SORTINGS_TOP) return top(ids, properties, either, range, limit, dateDetails)
  if (sorting === SORTINGS_NEW) return newest(ids, properties, either, limit)
  if (sorting === SORTINGS_RECENT) return recent(ids, properties, either, limit)
}

// `either` exists for referrers WITH_SOURCE only, where MongoDB matches `$or` of the
// properties instead of all of them
// `toExtra` adds report-specific fields, such as the country code the map needs
export default async ({
  ids,
  sorting,
  range,
  limit,
  dateDetails,
  properties,
  either = false,
  toValue,
  toExtra,
  idParts,
}) => {
  const entries = await rows({ ids, sorting, range, limit, dateDetails, properties, either })

  return entries.map((row) => {
    const value = toValue(row)

    return {
      id: recursiveId([value, ...idParts]),
      value,
      ...toExtra?.(row),
      count: row.count,
      created: row.createdAt == null ? undefined : new Date(row.createdAt),
    }
  })
}
