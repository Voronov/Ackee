import test from 'ava'

import { liveQuery } from '../../src/database/records.js'
import Record from '../../src/models/Record.js'
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
