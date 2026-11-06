import test from 'ava'

import aggregateNewActions from '../../src/aggregations/aggregateNewActions.js'
import aggregateRecentActions from '../../src/aggregations/aggregateRecentActions.js'
import aggregateTopActions from '../../src/aggregations/aggregateTopActions.js'
import { RANGES_LAST_7_DAYS } from '../../src/constants/ranges.js'
import { liveQuery } from '../../src/database/records.js'
import Action from '../../src/models/Action.js'
import Record from '../../src/models/Record.js'
import createDate from '../../src/utils/createDate.js'
import { cleanup, connectToDatabase } from '../resolvers/_utils.js'

// Only the explain test needs MongoDB; there is no server to close
test.after.always(cleanup({ close: () => {} }))

const indexKeys = (Model) => Model.schema.indexes().map(([keys]) => keys)

// Every report matches on both fields. Without the compound index the planner reads a
// domain's whole history.
test('records have a compound index on domainId and created', (t) => {
  t.true(indexKeys(Record).some((keys) => keys.domainId === 1 && keys.created === 1))
})

// The single-field index is a prefix of the compound one. Keeping it costs writes for nothing.
test('records have no separate domainId index', (t) => {
  t.false(indexKeys(Record).some((keys) => Object.keys(keys).join(',') === 'domainId'))
  t.not(Record.schema.path('domainId').options.index, true)
})

// The same for the lists of an event (ACKEE-75)
test('actions have a compound index on eventId and created, and no separate eventId index', (t) => {
  t.true(indexKeys(Action).some((keys) => keys.eventId === 1 && keys.created === 1))
  t.false(indexKeys(Action).some((keys) => Object.keys(keys).join(',') === 'eventId'))
  t.not(Action.schema.path('eventId').options.index, true)
})

const stagesOf = (plan) => [
  plan.stage,
  ...[plan.inputStage, ...(plan.inputStages ?? [])].filter(Boolean).flatMap(stagesOf),
]

const indexNamesOf = (plan) => [
  ...(plan.indexName == null ? [] : [plan.indexName]),
  ...[plan.inputStage, ...(plan.inputStages ?? [])].filter(Boolean).flatMap(indexNamesOf),
]

const directionsOf = (plan) => [
  ...(plan.direction == null ? [] : [plan.direction]),
  ...[plan.inputStage, ...(plan.inputStages ?? [])].filter(Boolean).flatMap(directionsOf),
]

// The live feed asks every two seconds. Other domains busy within the window must not be read.
test.serial('the query of the live feed reads only the views of the watched domains', async (t) => {
  await connectToDatabase()
  t.teardown(() => Record.deleteMany({ domainId: { $in: ['watched', 'busy'] } }))
  await Record.init()

  const now = Date.now()
  const view = (domainId, index) => ({
    domainId,
    siteLocation: 'https://example.com/',
    created: new Date(now - index),
    updated: new Date(now - index),
  })
  await Record.insertMany([
    ...Array.from({ length: 3 }, (_, index) => view('watched', index)),
    ...Array.from({ length: 300 }, (_, index) => view('busy', index)),
  ])

  const explained = await liveQuery(['watched'], new Date(now - 15 * 1000), 200).explain('executionStats')
  const plan = explained.queryPlanner.winningPlan.queryPlan ?? explained.queryPlanner.winningPlan

  t.true(stagesOf(plan).includes('IXSCAN'))
  t.false(stagesOf(plan).includes('COLLSCAN'))
  // Newest first comes from reading the index backwards, not from sorting in memory
  t.false(stagesOf(plan).includes('SORT'))
  t.deepEqual([...new Set(directionsOf(plan))], ['backward'])
  t.deepEqual([...new Set(indexNamesOf(plan))], ['domainId_1_created_1'])
  t.is(explained.executionStats.totalDocsExamined, 3)
})

// The plan of an aggregation: in the cursor stage, or on top when the whole pipeline ran as a query
const planOf = (explained) => {
  const planner = explained.queryPlanner ?? explained.stages[0].$cursor.queryPlanner
  return planner.winningPlan.queryPlan ?? planner.winningPlan
}

// An event with a few actions next to a busy one in the same days
test.serial('the lists of an event read only the actions of that event', async (t) => {
  await connectToDatabase()
  t.teardown(() => Action.deleteMany({ eventId: { $in: ['watched', 'busy'] } }))
  await Action.init()

  const now = Date.now()
  const action = (eventId, index) => ({
    eventId,
    key: `key-${index % 5}`,
    value: 1,
    created: new Date(now - index * 60 * 1000),
    updated: new Date(now - index * 60 * 1000),
  })
  await Action.insertMany([
    ...Array.from({ length: 3 }, (_, index) => action('watched', index)),
    ...Array.from({ length: 300 }, (_, index) => action('busy', index)),
  ])

  const dateDetails = createDate('UTC')
  const lists = {
    TOP: aggregateTopActions(['watched'], false, RANGES_LAST_7_DAYS, 30, dateDetails),
    NEW: aggregateNewActions(['watched'], 30),
    RECENT: aggregateRecentActions(['watched'], 30),
  }

  for (const [sorting, aggregation] of Object.entries(lists)) {
    const explained = await Action.aggregate(aggregation).explain('executionStats')
    const plan = planOf(explained)

    t.true(stagesOf(plan).includes('IXSCAN'), sorting)
    t.false(stagesOf(plan).includes('COLLSCAN'), sorting)
    t.deepEqual([...new Set(indexNamesOf(plan))], ['eventId_1_created_1'], sorting)
  }

  // Newest first comes from reading the index backwards: LIMIT over IXSCAN, no SORT in memory
  const recent = planOf(await Action.aggregate(lists.RECENT).explain('executionStats'))
  t.false(stagesOf(recent).includes('SORT'))
  t.is(stagesOf(recent)[0], 'LIMIT')
  t.deepEqual([...new Set(directionsOf(recent))], ['backward'])
})
