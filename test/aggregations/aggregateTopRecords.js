import test from 'ava'
import { randomUUID as uuid } from 'node:crypto'

import aggregateTopRecords from '../../src/aggregations/aggregateTopRecords.js'
import createDate from '../../src/utils/createDate.js'

test('return aggregation', (t) => {
  const result = aggregateTopRecords(uuid(), ['osName', 'osVersion'], createDate())

  t.true(Array.isArray(result))
})

// Equal counts at the cut-off of `$limit` must not depend on the order MongoDB happens to
// return them in, so the grouped fields follow the count as tie-breaks.
test('sort by count, then by every grouped property', (t) => {
  const result = aggregateTopRecords([uuid()], ['osName', 'osVersion'], 'LAST_7_DAYS', 10, createDate())
  const sort = result.find((stage) => stage.$sort != null).$sort

  t.deepEqual(Object.keys(sort), ['count', '_id.osName', '_id.osVersion'])
  t.is(sort.count, -1)
})
