import test from 'ava'
import listen from 'test-listen'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import * as users from '../../src/database/users.js'
import AuditLog from '../../src/models/AuditLog.js'
import Domain from '../../src/models/Domain.js'
import Membership from '../../src/models/Membership.js'
import Token from '../../src/models/Token.js'
import User from '../../src/models/User.js'
import Workspace from '../../src/models/Workspace.js'
import server from '../../src/server.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from './_utils.js'

const base = listen(server)

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

// An MCP client signed in with a token of Ackee, as Claude Code would be
const connect = async (token) => {
  const client = new Client({ name: 'test', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', await base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })

  await client.connect(transport)

  return client
}

// Closed when the test ends, also after a failed assertion, or the run hangs on the connection
const connected = async (t, token) => {
  const client = await connect(token)
  t.teardown(() => client.close())

  return client
}

// The JSON answer of a tool, or the error text when the call failed
const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args })
  const text = result.content[0]?.text ?? ''

  return result.isError === true ? { error: text } : JSON.parse(text)
}

test.serial('without a token the endpoint answers 401 and nothing else', async (t) => {
  const response = await fetch(new URL('/mcp', await base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })

  t.is(response.status, 401)
  t.deepEqual(Object.keys(await response.json()), ['error'])
})

test.serial('the six tools are listed, and none of them takes a query', async (t) => {
  const client = await connected(t, t.context.token.id)
  const { tools } = await client.listTools()

  t.deepEqual(tools.map((tool) => tool.name).toSorted(), ['compare', 'domains', 'events', 'live', 'report', 'top'])

  for (const tool of tools) {
    const properties = Object.keys(tool.inputSchema.properties ?? {})

    t.false(
      properties.some((property) => /query|document|field|mutation/i.test(property)),
      tool.name,
    )
    t.true(tool.annotations?.readOnlyHint === true, tool.name)
  }
})

test.serial('the domains tool lists the domains of the token, and an empty list for a token without any', async (t) => {
  const owner = await connected(t, t.context.token.id)
  t.deepEqual(await call(owner, 'domains'), [{ id: t.context.domain.id, title: 'Example' }])

  // A fresh account owns a personal workspace, but has no domain in it yet
  const { user, workspace } = await users.add({ email: 'nobody-mcp@example.com', password: 'sufficiently-long' })
  const token = await Token.create({ userId: user.id })
  const stranger = await connected(t, token.id)

  t.deepEqual(await call(stranger, 'domains'), [])

  await Promise.all([
    Token.deleteOne({ id: token.id }),
    Membership.deleteMany({ userId: user.id }),
    Workspace.deleteOne({ id: workspace.id }),
    User.deleteOne({ id: user.id }),
  ])
})

test.serial('top and report answer with the data of the reports', async (t) => {
  const client = await connected(t, t.context.token.id)

  const pages = await call(client, 'top', { domainId: t.context.domain.id, dimension: 'pages', range: 'LAST_6_MONTHS' })
  t.deepEqual(pages.entries, [{ value: 'https://example.com/', count: 14 }])

  // The fixture has one view a day for fourteen days
  const report = await call(client, 'report', { domainId: t.context.domain.id, metric: 'views', limit: 15 })
  t.is(report.entries.length, 15)
  t.is(
    report.entries.reduce((total, entry) => total + entry.count, 0),
    14,
  )

  const durations = await call(client, 'report', { metric: 'durations', limit: 3 })
  t.is(durations.unit, 'milliseconds')
  t.is(durations.entries.length, 3)
})

test.serial('live, events and compare answer', async (t) => {
  const client = await connected(t, t.context.token.id)

  const live = await call(client, 'live', { domainId: t.context.domain.id })
  // The newest view of the fixture is a minute old, so its visitor still counts as active
  t.true(live.activeVisitors >= 0)
  t.true(live.viewsToday >= 0)

  // The fixture adds an event per test and never removes it, so the list grows across tests
  const events = await call(client, 'events', { limit: 5 })
  const event = events.find((entry) => entry.id === t.context.event.id)
  t.is(event.title, 'Example')
  t.true(Array.isArray(event.perDay))
  t.true(Array.isArray(event.topKeys))

  const compare = await call(client, 'compare', { domainIds: [t.context.domain.id], periods: 7 })
  t.is(compare.domains.length, 1)
  t.is(compare.domains[0].title, 'Example')
  t.is(compare.domains[0].current + compare.domains[0].previous, 14)
})

test.serial('every call lands in the audit log with its arguments', async (t) => {
  await AuditLog.deleteMany({ userId: t.context.user.id })
  const client = await connected(t, t.context.token.id)

  await call(client, 'domains')
  await call(client, 'top', { domainId: t.context.domain.id, dimension: 'browsers' })
  await call(client, 'live')

  const entries = await AuditLog.find({ userId: t.context.user.id }).sort({ created: 1 }).lean()

  t.deepEqual(
    entries.map((entry) => entry.action),
    ['mcp.domains', 'mcp.top', 'mcp.live'],
  )
  t.true(entries.every((entry) => entry.email === t.context.user.email))
  t.true(entries.every((entry) => entry.workspaceId === t.context.workspace.id))
  t.true(entries[1].details.includes('"dimension":"browsers"'))
  t.is(entries[1].targetId, t.context.domain.id)
})

test.serial('a token of one workspace never sees the domains of another', async (t) => {
  const { user, workspace } = await users.add({ email: 'mallory-mcp@example.com', password: 'sufficiently-long' })
  const domain = await Domain.create({ title: 'mallory.example.com', workspaceId: workspace.id })
  const token = await Token.create({ userId: user.id })
  const mallory = await connected(t, token.id)

  t.deepEqual(await call(mallory, 'domains'), [{ id: domain.id, title: 'mallory.example.com' }])

  // The domain of the fixture belongs to someone else: the same answer as for one that does not exist
  const foreign = await call(mallory, 'top', { domainId: t.context.domain.id, dimension: 'pages' })
  t.regex(foreign.error, /unknown domain/i)

  const compare = await call(mallory, 'compare', { domainIds: [t.context.domain.id] })
  t.regex(compare.error, /unknown domain/i)

  // Nothing of it was written to the other workspace
  t.is(await AuditLog.countDocuments({ userId: user.id, workspaceId: t.context.workspace.id }), 0)

  await Promise.all([
    Token.deleteOne({ id: token.id }),
    Domain.deleteOne({ id: domain.id }),
    Membership.deleteMany({ userId: user.id }),
    Workspace.deleteOne({ id: workspace.id }),
    User.deleteOne({ id: user.id }),
  ])
})
