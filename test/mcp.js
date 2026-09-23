import test from 'ava'
import listen from 'test-listen'
import { spawn } from 'node:child_process'

import server from '../src/server.js'
import createRequest from '../src/mcp/client.js'
import { PROTOCOL_VERSION, createServer } from '../src/mcp/rpc.js'
import createTools from '../src/mcp/tools.js'
import { cleanup, cleanupDatabase, connectToDatabase, fillDatabase } from './resolvers/_utils.js'

const base = listen(server)

const handlerFor = async (token) => {
  const request = createRequest(await base, token)

  return createServer({ name: 'ackee', version: '4.0.1', tools: createTools(request) })
}

const callTool = async (handle, name, args = {}) => {
  const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  const text = answer.result.content[0].text

  return {
    isError: answer.result.isError === true,
    text,
    value: answer.result.isError === true ? null : JSON.parse(text),
  }
}

test.before(connectToDatabase)
test.after.always(cleanup(server))
test.beforeEach(fillDatabase)
test.afterEach.always(cleanupDatabase)

test.serial('initialize announces the tools capability', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

  t.is(answer.result.protocolVersion, PROTOCOL_VERSION)
  t.is(answer.result.serverInfo.name, 'ackee')
  t.truthy(answer.result.capabilities.tools)
})

test.serial('every tool has a description and a schema', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

  t.true(answer.result.tools.length > 0)

  for (const tool of answer.result.tools) {
    t.is(typeof tool.name, 'string')
    // A model chooses a tool by reading this, so an empty one is a broken tool.
    t.true(tool.description.length > 20, tool.name)
    t.is(tool.inputSchema.type, 'object')
    // The handler is the server's business and must not travel to the client.
    t.false('handler' in tool)
  }
})

test.serial('an unknown method is a JSON-RPC error', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' })

  t.is(answer.error.code, -32_601)
})

test.serial('list_domains returns the domains of the token', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const { value } = await callTool(handle, 'list_domains')

  t.true(value.some((domain) => domain.id === t.context.domain.id))
})

test.serial('get_facts reads one domain', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const { value } = await callTool(handle, 'get_facts', { domainId: t.context.domain.id })

  t.is(value.title, t.context.domain.title)
  t.is(typeof value.viewsToday, 'number')
  t.is(typeof value.averageViews.count, 'number')
})

test.serial('get_breakdown ranks a dimension', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const { value } = await callTool(handle, 'get_breakdown', {
    domainId: t.context.domain.id,
    breakdown: 'countries',
    range: 'LAST_30_DAYS',
  })

  // The fixture writes 10 records from Ukraine and 4 from Germany.
  t.is(value[0].value, 'Ukraine')
  t.is(value[0].count, 10)
})

test.serial('get_views_over_time returns a series', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const { value } = await callTool(handle, 'get_views_over_time', { domainId: t.context.domain.id, limit: 7 })

  t.is(value.length, 7)
  t.is(typeof value[0].value, 'string')
})

test.serial('a failing tool answers the model instead of the client', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const answer = await callTool(handle, 'get_facts', { domainId: '00000000-0000-4000-8000-000000000000' })

  // The model has to see this to correct itself, so it is a result, not a JSON-RPC error.
  t.true(answer.isError)
  t.true(answer.text.includes('list_domains'))
})

test.serial('an unknown tool is a JSON-RPC error', async (t) => {
  const handle = await handlerFor(t.context.token.id)
  const answer = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'drop_everything' } })

  t.is(answer.error.code, -32_602)
})

test.serial('a bad token is reported as a bad token', async (t) => {
  const handle = await handlerFor('not-a-token')
  const answer = await callTool(handle, 'list_domains')

  t.true(answer.isError)
  t.true(answer.text.includes('ACKEE_TOKEN'))
})

test.serial('the process speaks line-delimited JSON on stdio', async (t) => {
  const child = spawn(process.execPath, ['src/mcp/index.js'], {
    env: { ...process.env, ACKEE_SERVER: await base, ACKEE_TOKEN: t.context.token.id },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const lines = []

  const answers = new Promise((resolve) => {
    let buffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk

      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) if (part.trim() !== '') lines.push(JSON.parse(part))

      if (lines.length >= 2) resolve(lines)
    })
  })

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
  // A notification carries no id and must not be answered, so the next answer is id 2.
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)

  const received = await answers

  child.kill()

  t.is(received[0].id, 1)
  t.is(received[0].result.serverInfo.name, 'ackee')
  t.is(received[1].id, 2)
  t.true(received[1].result.tools.length > 0)
})
