# ADR-005: The MCP server writes its own protocol

**Status:** accepted
**Date:** 2026-09-22
**Direction:** K — MCP

## Context

Direction K asks for Ackee's reports to be available to an assistant as tools. The
protocol for that is MCP, and MCP has an official JavaScript SDK,
`@modelcontextprotocol/sdk`.

Adding it is one line in `package.json`. It brings seventeen dependencies:

```
ajv, ajv-formats, content-type, cors, cross-spawn, eventsource,
eventsource-parser, express, express-rate-limit, hono, @hono/node-server,
jose, json-schema-typed, pkce-challenge, raw-body, zod, zod-to-json-schema
```

Most of them serve the HTTP transport and its OAuth flow: `hono` and `@hono/node-server`
are a second web framework beside the Express the server already runs, `jose` and
`pkce-challenge` are an OAuth client, `cors` and `express-rate-limit` are middleware for
a server we do not start.

The Ackee MCP server uses none of that. It is started by the assistant and talks to it
over a pipe.

## Decision

Write the protocol out instead.

`src/mcp/rpc.js` is the whole of it: JSON-RPC 2.0 over newline-delimited JSON, and five
methods — `initialize`, `tools/list`, `tools/call`, `ping`, and notifications, which are
answered by not answering them.

## Why

- **The used fraction is small and stable.** Five methods, one transport. The part of MCP
  that moves is the part we do not touch: authorisation, resources, prompts, sampling.
- **The cost is paid by everyone.** These dependencies would go into the server image,
  which also runs ingest and the worker, for a feature most instances never start.
- **It matches how the rest of this version was decided.** ADR-004 chose ClickHouse for a
  measured 1642×. Direction D dropped Redis and BullMQ because a cron-style worker did the
  job. A second web framework for a stdio server is the same kind of weight.

## Consequences

**What we accept**

- A change in the specification is our work, not a version bump. The compatibility we
  declare is one string, `PROTOCOL_VERSION`, and it is wrong the day the specification
  moves and we do not.
- We have no schema validation of tool arguments. The SDK validates with zod; here a tool
  reads what it was given and defaults what is missing. A wrong argument reaches the
  handler.

**What we get**

- Zero new dependencies for the feature.
- The protocol is readable in one file of about 120 lines, so a reader can see what the
  server actually promises without opening `node_modules`.
- The server is tested end to end: `test/mcp.js` spawns the real process and speaks to it
  over its pipes.

## When to revisit

If the server ever needs to be reachable over HTTP — so that an assistant which is not on
the same machine can use it — the transport, the authorisation and the session handling
all arrive at once. That is the point where the SDK stops being weight and starts being
the work, and this decision should be reversed.
