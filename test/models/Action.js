import test from 'ava'

import Action from '../../src/models/Action.js'

const hasIndex = (Model, fields) =>
  Model.schema.indexes().some(([keys]) => JSON.stringify(keys) === JSON.stringify(fields))

test('has compound index on eventId and created', (t) => {
  t.true(hasIndex(Action, { eventId: 1, created: 1 }))
})

// The standalone eventId index is deliberately absent: it is a prefix of the compound
// one, so it would only cost writes. Same reasoning as Record.
test('does not keep a standalone eventId index', (t) => {
  t.false(hasIndex(Action, { eventId: 1 }))
})
