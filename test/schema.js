import test from 'ava'
import { findBreakingChanges, findDangerousChanges, buildSchema } from 'graphql'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { printedSchema } from '../src/types/schema.js'

const snapshotPath = new URL('fixtures/schema.graphql', import.meta.url)
const snapshot = await readFile(snapshotPath, 'utf8')

const changes = (find, before, after) =>
  find(buildSchema(before), buildSchema(after)).map(({ type, description }) => `${type}: ${description}`)

const breaking = (before, after) => changes(findBreakingChanges, before, after)

// Edits the snapshot in one place. Fails when the text is gone, so a test cannot pass by editing nothing.
const edit = (t, from, to) => {
  t.is(snapshot.split(from).length, 2, `"${from}" must occur once in the snapshot`)
  return snapshot.replace(from, to)
}

test('the schema has no breaking change against the snapshot', (t) => {
  const current = printedSchema()

  t.deepEqual(
    breaking(snapshot, current),
    [],
    'Clients (UI, ackee-tracker, MCP, /export) may break. Keep the old field or argument, or agree on the change and run `npm run schema:update`.',
  )

  // Additions are fine, but the snapshot should follow them, or they are not protected
  if (current !== snapshot) {
    t.log('The schema differs from the snapshot without a breaking change. Run `npm run schema:update`.')
    for (const change of changes(findDangerousChanges, snapshot, current)) t.log(change)
  }
})

test('a removed field is a breaking change', (t) => {
  const after = edit(t, '  """Data of all existing domains."""\n  domains: [Domain!]\n', '')
  t.deepEqual(breaking(snapshot, after), ['FIELD_REMOVED: Query.domains was removed.'])
})

test('an argument that became required is a breaking change', (t) => {
  const after = edit(t, 'facts(domainId: ID, filters', 'facts(domainId: ID!, filters')
  t.deepEqual(breaking(snapshot, after), [
    'ARG_CHANGED_KIND: Query.facts arg domainId has changed type from ID to ID!.',
  ])
})

test('a changed field type is a breaking change', (t) => {
  const after = edit(t, 'countryAvailable: Boolean!', 'countryAvailable: String!')
  t.deepEqual(breaking(snapshot, after), [
    'FIELD_CHANGED_KIND: Query.countryAvailable changed type from Boolean! to String!.',
  ])
})

test('an added field or optional argument is not a breaking change', (t) => {
  const withField = edit(t, 'type Query {\n', 'type Query {\n  newField: String\n')
  t.deepEqual(breaking(snapshot, withField), [])

  const withArgument = edit(t, 'auditLog(limit: Int = 50)', 'auditLog(limit: Int = 50, before: ID)')
  t.deepEqual(breaking(snapshot, withArgument), [])
})

test('npm run schema:update writes the current schema', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ackee-schema-'))
  t.teardown(() => rm(folder, { recursive: true, force: true }))

  const target = path.join(folder, 'schema.graphql')
  await promisify(execFile)(process.execPath, ['scripts/update-schema.js', target])

  t.is(await readFile(target, 'utf8'), printedSchema())
})
