import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'

import aggregateNewRecords from '../../src/aggregations/aggregateNewRecords.js'

test('return aggregation', (t) => {
  const result = aggregateNewRecords(uuid(), ['siteReferrer'])

  t.true(Array.isArray(result))
})

// `$first` depends on the order documents arrive in, which changes with the query plan.
test('use the first time a value was seen, with the value as tie-break', (t) => {
  const result = aggregateNewRecords([uuid()], ['siteReferrer'])
  const group = result.find((stage) => stage.$group != null).$group
  const sort = result.find((stage) => stage.$sort != null).$sort

  t.deepEqual(group.created, { $min: '$created' })
  t.deepEqual(sort, { 'created': -1, '_id.siteReferrer': 1 })
})
