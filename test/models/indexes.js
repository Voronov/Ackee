import test from 'ava'

import Record from '../../src/models/Record.js'

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
