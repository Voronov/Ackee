import test from 'ava'

import Record from '../../src/models/Record.js'

const hasIndex = (Model, fields) =>
  Model.schema.indexes().some(([keys]) => JSON.stringify(keys) === JSON.stringify(fields))

test('has compound index on domainId and created', (t) => {
  t.true(hasIndex(Record, { domainId: 1, created: 1 }))
})

// The standalone domainId index is deliberately absent: it is a prefix of the compound
// one, so it would only cost writes.
test('keeps single field indexes', (t) => {
  t.true(hasIndex(Record, { clientId: 1 }))
  t.true(hasIndex(Record, { created: 1 }))
  t.true(hasIndex(Record, { updated: 1 }))
})
