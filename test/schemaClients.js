import test from 'ava'
import { getVariableValues, parse, validate } from 'graphql'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as z from 'zod/v4'

import tools from '../src/mcp/tools.js'
import { schema } from '../src/types/schema.js'

const current = schema()

// Validates a document as the server would, and the variables the client sends with it
const problems = (query, variables = {}) => {
  const document = parse(query)
  const errors = validate(current, document)
  if (errors.length > 0) return errors.map((error) => error.message)

  const operation = document.definitions.find((definition) => definition.kind === 'OperationDefinition')
  const values = getVariableValues(current, operation.variableDefinitions ?? [], variables)

  return (values.errors ?? []).map((error) => error.message)
}

// The tracker file Ackee serves as /tracker.js, so the test reads what sites really send
const trackerQueries = async () => {
  const file = createRequire(import.meta.url).resolve('ackee-tracker')
  const source = await readFile(file, 'utf8')
  const found = [...source.matchAll(/query:("(?:[^"\\]|\\.)*")/gu)].map((match) => JSON.parse(match[1]))

  return Object.fromEntries(found.map((query) => [query.match(/mutation (\w+)/u)[1], query]))
}

test('the tracker sends createRecord and updateRecord that fit the schema', async (t) => {
  const queries = await trackerQueries()

  t.deepEqual(Object.keys(queries).toSorted(), ['createAction', 'createRecord', 'updateAction', 'updateRecord'])

  const record = {
    siteLocation: 'https://example.com/',
    siteReferrer: 'https://example.org/',
    source: 'newsletter',
    siteLanguage: 'en',
    screenWidth: 1920,
    screenHeight: 1080,
    screenColorDepth: 24,
    deviceName: 'iPhone',
    deviceManufacturer: 'Apple',
    osName: 'iOS',
    osVersion: '18',
    browserName: 'Safari',
    browserVersion: '18',
    browserWidth: 390,
    browserHeight: 844,
  }

  t.deepEqual(problems(queries.createRecord, { domainId: 'domain', input: record }), [])
  t.deepEqual(problems(queries.updateRecord, { recordId: 'record' }), [])
  t.deepEqual(problems(queries.createAction, { eventId: 'event', input: { key: 'sale', value: 1 } }), [])
  t.deepEqual(problems(queries.updateAction, { actionId: 'action', input: { key: 'sale', value: 2 } }), [])
})

// Arguments that reach every query of the tools: each metric and each dimension, with and without a domain
const argumentsOf = {
  domains: [{}],
  report: [{ metric: 'views' }, { metric: 'durations', domainId: 'domain' }],
  top: ['pages', 'referrers', 'browsers', 'systems', 'devices', 'sizes', 'languages'].map((dimension) => ({
    dimension,
    domainId: 'domain',
  })),
  live: [{}, { domainId: 'domain' }],
  events: [{}],
  compare: [{ domainIds: ['domain'] }],
}

// Answers every query with empty data, so a tool runs to its end and sends all its queries
const recorder = (sent) => (query, variables) => {
  sent.push({ query, variables })
  return Promise.resolve({ domains: [], events: [], facts: {}, statistics: new Proxy({}, { get: () => [] }) })
}

test('the six MCP tools send queries that fit the schema', async (t) => {
  t.deepEqual(
    tools.map((tool) => tool.name),
    Object.keys(argumentsOf),
  )

  for (const tool of tools) {
    for (const input of argumentsOf[tool.name]) {
      const sent = []
      // The defaults of the input schema, as the MCP SDK applies them
      await tool.run(z.object(tool.inputSchema).parse(input), recorder(sent))

      t.true(sent.length > 0, `${tool.name} sent no query`)
      for (const { query, variables } of sent) {
        t.deepEqual(problems(query, variables), [], `${tool.name} ${JSON.stringify(input)}`)
      }
    }
  }
})
