#!/usr/bin/env node

/*
 * The Ackee MCP server.
 *
 * Started by an assistant, not by a person: it reads JSON-RPC on stdin and writes it on
 * stdout, so nothing else may be printed there. A message on stdout that is not a
 * protocol message ends the session.
 */

// A JSON module has one export, the whole file, so the version is picked out below.
import packageJson from '../../package.json' with { type: 'json' }

import createRequest from './client.js'
import { createServer, listen } from './rpc.js'
import createTools from './tools.js'

const url = process.env.ACKEE_SERVER
const token = process.env.ACKEE_TOKEN

if (url == null || token == null) {
  // Written to stderr, which the assistant shows as a log rather than reading as a message.
  process.stderr.write(
    'ACKEE_SERVER and ACKEE_TOKEN are required.\n' +
      'ACKEE_SERVER is the address of your Ackee, for example https://ackee.example.com\n' +
      'ACKEE_TOKEN is a permanent token, created under Settings in the interface.\n',
  )
  process.exit(1)
}

const handle = createServer({
  name: 'ackee',
  version: packageJson.version,
  tools: createTools(createRequest(url, token)),
})

listen(handle, process.stdin, process.stdout)
