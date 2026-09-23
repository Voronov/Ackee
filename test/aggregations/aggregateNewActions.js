import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'

import aggregateNewActions from '../../src/aggregations/aggregateNewActions.js'

test('takes the earliest created per key, so the order does not depend on the query plan', (t) => {
  const result = aggregateNewActions([uuid()], 10)

  const groupIndex = result.findIndex((stage) => stage.$group != null)

  t.deepEqual(result[groupIndex].$group.created, { $min: '$created' })
  t.deepEqual(result[groupIndex + 1], { $sort: { 'created': -1, '_id.key': 1 } })
  t.deepEqual(result.at(-1), { $limit: 10 })
})

test('has no sort before the group, which an index scan would make pointless anyway', (t) => {
  const result = aggregateNewActions([uuid()], 10)

  const groupIndex = result.findIndex((stage) => stage.$group != null)

  t.is(result[groupIndex - 1].$sort, undefined)
})
