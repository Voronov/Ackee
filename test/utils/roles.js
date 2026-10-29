import test from 'ava'
import mockedEnv from 'mocked-env'

import { ROLES, isRole, serves } from '../../src/utils/roles.js'

test('all is the default and does everything, as before the roles', (t) => {
  const restore = mockedEnv({ ACKEE_ROLE: undefined })

  for (const part of ['http', 'app', 'tracking', 'jobs']) t.true(serves(part), part)

  restore()
})

test('each role serves its parts and nothing else', (t) => {
  t.deepEqual(
    Object.fromEntries(
      ROLES.map((role) => [role, ['http', 'app', 'tracking', 'jobs'].filter((part) => serves(part, role))]),
    ),
    {
      all: ['http', 'app', 'tracking', 'jobs'],
      api: ['http', 'app', 'tracking'],
      ingest: ['http', 'tracking'],
      worker: ['jobs'],
    },
  )
})

test('a role is one of the four, anything else is refused', (t) => {
  for (const role of ROLES) t.true(isRole(role))
  for (const value of ['API', 'nope', '', undefined, null]) t.false(isRole(value), String(value))
  t.false(serves('http', 'nope'))
})
