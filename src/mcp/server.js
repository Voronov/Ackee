import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { REPORTS_READ } from '../constants/permissions.js'
import * as auditLog from '../database/auditLog.js'
import * as domains from '../database/domains.js'
import config from '../utils/config.js'
import createApolloServer from '../utils/createApolloServer.js'
import createDate from '../utils/createDate.js'
import KnownError from '../utils/KnownError.js'
import { domainScope } from '../utils/permissions.js'
import signale from '../utils/signale.js'
import resolveViewer from '../utils/viewer.js'
import tools from './tools.js'

/*
 * The MCP endpoint, /mcp (ACKEE-27, ADR-008): an AI assistant asks for reports in its own
 * words, the assistant calls these tools. Read-only by construction: the tools run fixed
 * queries of the reports API (mcp/tools.js), in this process, as the token's viewer.
 *
 * Stateless: a server and a transport per request, as the SDK recommends for HTTP without
 * sessions. The SDK is pinned in package.json, see docs/MCP.md for the protocol version.
 */

// One Apollo Server for every MCP request, started on the first one. The same schema and
// resolvers as /api, so there is no second set of rules to keep in step.
let apollo

const apolloServer = () => {
  if (apollo == null) {
    const server = createApolloServer()
    apollo = server.start().then(() => server)
  }

  return apollo
}

// The context the resolvers see, as createContext builds it for /api, with the viewer the
// token resolved to. Nothing of the tracking path: the endpoint never creates a view.
const contextFor = (viewer, headers) => ({
  isDemoMode: config.isDemoMode,
  viewer,
  isIgnored: false,
  dateDetails: createDate(headers['time-zone']),
  userAgent: headers['user-agent'],
  ingestKey: undefined,
  origin: headers['origin'],
  ip: undefined,
  setCookies: [],
  setHeaders: [],
})

// Runs one of the fixed queries. A GraphQL error becomes a plain error, which the SDK answers
// as a failed tool call rather than a failed request.
const executor = (viewer, headers) => async (query, variables) => {
  const server = await apolloServer()
  const { body } = await server.executeOperation({ query, variables }, { contextValue: contextFor(viewer, headers) })
  const result = body.kind === 'single' ? body.singleResult : undefined

  if (result?.errors?.length > 0) throw new Error(result.errors.map((error) => error.message).join('; '))

  return result?.data
}

// The workspace a call is written to the audit log for: the one of the domain asked for, else
// the first of the viewer. A token without a workspace has nothing to charge, and sees nothing.
const workspaceOf = async (viewer, domainId) => {
  if (domainId != null) {
    const entry = await domains.get(domainId, domainScope(viewer, REPORTS_READ))
    if (entry != null) return entry.workspaceId
  }

  return viewer.memberships[0]?.workspaceId
}

const shorten = (text, limit = 200) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

// Exported for the tests: the names of the tools and what they take, without a request
export const toolNames = () => tools.map((tool) => tool.name)

const createServer = (viewer, headers) => {
  const server = new McpServer({ name: 'ackee', version: config.build })
  const execute = executor(viewer, headers)

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true } },
      async (args = {}) => {
        const result = await tool.run(args, execute)

        // Every call lands in the audit log, with its arguments, like a change made in the UI
        const workspaceId = await workspaceOf(viewer, args.domainId ?? args.domainIds?.[0])
        if (workspaceId != null) {
          await auditLog.record(viewer, workspaceId, `mcp.${tool.name}`, args.domainId, shorten(JSON.stringify(args)))
        }

        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      },
    )
  }

  return server
}

export default async (request, response) => {
  // The same tokens as /api, resolved the same way. Without one there is nothing to answer.
  const viewer = await resolveViewer(request.headers.authorization, config.ttl)

  if (viewer instanceof KnownError) return response.status(401).json({ error: viewer.message })

  const server = createServer(viewer, request.headers)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })

  response.on('close', () => {
    transport.close()
    server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
  } catch (error) {
    signale.warn(`MCP request failed: ${error.message}`)
    if (response.headersSent === false) response.status(500).json({ error: 'MCP request failed' })
  }
}
