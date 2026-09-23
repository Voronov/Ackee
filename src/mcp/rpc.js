/*
 * The Model Context Protocol, as much of it as a read-only tool server needs.
 *
 * MCP over stdio is JSON-RPC 2.0 with one message per line. The official SDK brings
 * seventeen dependencies, most of them for the HTTP transport and its OAuth flow, which
 * this server does not use: it speaks to whatever started it, over a pipe. So the wire
 * format is written out here instead. It is five methods.
 *
 * https://modelcontextprotocol.io/specification
 */

// The version this server was written against. A client that asks for another one is
// answered with this, and the specification says it may then refuse.
export const PROTOCOL_VERSION = '2025-06-18'

// JSON-RPC error codes, from the specification.
const METHOD_NOT_FOUND = -32_601
const INVALID_PARAMS = -32_602
const INTERNAL_ERROR = -32_603
const PARSE_ERROR = -32_700

export const createServer = ({ name, version, tools }) => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  const call = async (parameters) => {
    const tool = byName.get(parameters?.name)

    if (tool == null) {
      return { error: { code: INVALID_PARAMS, message: `Unknown tool '${parameters?.name}'` } }
    }

    try {
      const result = await tool.handler(parameters.arguments ?? {})

      return { result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }
    } catch (error) {
      /*
       * A tool that fails answers with a result, not with a JSON-RPC error. The difference
       * matters: an error is a broken call the model cannot see, while this is an answer
       * the model reads and can act on, such as by asking for a domain that exists.
       */
      return { result: { content: [{ type: 'text', text: error.message }], isError: true } }
    }
  }

  return (request) => {
    switch (request.method) {
      case 'initialize': {
        return {
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name, version },
          },
        }
      }
      case 'tools/list': {
        return {
          result: {
            tools: tools.map(({ name: toolName, description, inputSchema }) => ({
              name: toolName,
              description,
              inputSchema,
            })),
          },
        }
      }
      case 'tools/call': {
        return call(request.params)
      }
      case 'ping': {
        return { result: {} }
      }
      default: {
        return { error: { code: METHOD_NOT_FOUND, message: `Unknown method '${request.method}'` } }
      }
    }
  }
}

/*
 * Reads whole lines off a stream and answers each one.
 *
 * A request carries an id and gets an answer. A notification has no id and gets none:
 * answering it is a protocol error, which is why `initialized` needs no case above.
 */
export const listen = (handle, input, output) => {
  let buffer = ''

  const write = (message) => output.write(`${JSON.stringify(message)}\n`)

  input.setEncoding('utf8')

  input.on('data', async (chunk) => {
    buffer += chunk

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim() === '') continue

      let request

      try {
        request = JSON.parse(line)
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Could not parse the message' } })
        continue
      }

      if (request.id == null) continue

      try {
        const answer = await handle(request)

        write({ jsonrpc: '2.0', id: request.id, ...answer })
      } catch (error) {
        write({ jsonrpc: '2.0', id: request.id, error: { code: INTERNAL_ERROR, message: error.message } })
      }
    }
  })
}
