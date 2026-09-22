# MCP server

Ackee ships a [Model Context Protocol](https://modelcontextprotocol.io) server, so an
assistant can answer questions about your sites by reading them, instead of you opening
the dashboard and reading them out.

> Which pages on the shop were read most last week, and where did those readers come from?

## Setting it up

You need two things: the address of your Ackee, and a permanent token.

Create the token in the interface under **Settings → Tokens**. A permanent token is the
right kind: a session token expires while the assistant is not looking.

### Claude Desktop or Claude Code

Add this to your MCP configuration:

```json
{
  "mcpServers": {
    "ackee": {
      "command": "node",
      "args": ["/path/to/ackee/src/mcp/index.js"],
      "env": {
        "ACKEE_SERVER": "https://ackee.example.com",
        "ACKEE_TOKEN": "your-permanent-token"
      }
    }
  }
}
```

### By hand

```bash
ACKEE_SERVER=https://ackee.example.com ACKEE_TOKEN=... npm run mcp
```

It reads JSON-RPC on standard input and writes it on standard output, so on its own it
will sit there and wait. That is what it is meant to do.

## The tools

| Tool                  | Answers                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_domains`        | Which sites can I read, and what are their ids                                                             |
| `get_facts`           | How is this site doing: visitors now, views today, this month, this year, and the change against last week |
| `get_views_over_time` | Views as a series, for a trend, a spike or a drop                                                          |
| `get_breakdown`       | Which pages, referrers, countries, languages, browsers, systems, devices or screen sizes                   |
| `get_durations`       | How long a visit lasts, as a series                                                                        |
| `get_recent_pages`    | What is being read right now                                                                               |

Every tool but `list_domains` needs a domain id, and the id is not the domain name, so an
assistant calls `list_domains` first.

## What it can and cannot do

**It reads.** There is no tool that creates, changes or deletes anything. An assistant
given this server can tell you about your traffic and can do nothing to your Ackee.

**It sees what the token sees.** The server is an ordinary API client: it sends the token
with every request, and the API turns that token into a viewer and the viewer into a set
of workspaces, exactly as it does for the interface. Reading the database directly would
have been shorter and would have meant writing that scoping a second time.

**A failing tool answers rather than fails.** Asking for a domain that does not exist
comes back as a readable message the assistant can act on — usually by calling
`list_domains` — instead of a protocol error it cannot see.

## Notes

The wire format is written out in `src/mcp/rpc.js` rather than taken from the official
SDK. See [ADR-005](adr/ADR-005-mcp.md) for why.
