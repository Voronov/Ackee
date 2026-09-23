import test from 'ava'

import Action from '../../src/models/Action.js'

const hasIndex = (Model, fields) =>
  Model.schema.indexes().some(([keys]) => JSON.stringify(keys) === JSON.stringify(fields))

test('has compound index on eventId and created', (t) => {
  t.true(hasIndex(Action, { eventId: 1, created: 1 }))
})
