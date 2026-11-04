# MCP

Ackee answers questions of an AI assistant through the [Model Context Protocol](https://modelcontextprotocol.io): the assistant calls the tools below, Ackee runs the reports and answers with the numbers. The endpoint is `POST /mcp` of the same server, next to `/api`.

It is **read-only**. Every tool runs a fixed query of the [API](API.md); nothing the assistant sends is a query or a field name, so no mutation of the API can be reached this way. Every call is written to the audit log of the workspace, with its arguments, like a change made in the UI.

## Token

The endpoint takes the same tokens as the API, in the `Authorization: Bearer` header. Create a permanent token under Settings → Permanent Tokens. The assistant then sees exactly what the owner of the token sees: the domains of the workspaces the token's account is a member of. A token of an account without a domain gets an empty list, nothing else.

## Connecting an assistant

Claude Code:

```
claude mcp add --transport http ackee https://ackee.example.com/mcp --header "Authorization: Bearer <token>"
```

Any other client that speaks Streamable HTTP connects the same way: the URL of `/mcp` and the `Authorization` header. The server is stateless: no session id, no server-sent notifications, every request stands on its own.

## Tools

| Tool      | Arguments                                                                                                                    | Answer                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `domains` | –                                                                                                                            | The domains the token may read, `id` and `title`. The other tools take a `domainId` from here, or none for all domains.            |
| `report`  | `domainId?`, `metric` (`views`, `durations`), `interval` (`DAILY`, `MONTHLY`, `YEARLY`), `type` (`TOTAL`, `UNIQUE`), `limit` | Views or visit durations over time, newest first, one entry per interval. Durations in milliseconds.                               |
| `top`     | `domainId?`, `dimension` (`pages`, `referrers`, `browsers`, `systems`, `devices`, `sizes`, `languages`), `range`, `limit`    | A top list for the range (`LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`, `LAST_6_MONTHS`).                                        |
| `live`    | `domainId?`                                                                                                                  | Visitors on the site right now, unique views today, this month and this year, the averages of the last two weeks and their change. |
| `events`  | `limit`                                                                                                                      | The events of the workspace: totals per day of the last two weeks and the top keys of the last seven days.                         |
| `compare` | `domainIds` (1 to 10), `interval`, `type`, `periods`                                                                         | For each domain the sum of the current period and of the one before it, and the change in percent.                                 |

`domainId` left out means all domains of the token together, as on the overview.

## Versions

The protocol changes, so the server pins its SDK: `@modelcontextprotocol/sdk` 1.32.2 in `package.json`, without a caret. That SDK speaks protocol version `2025-11-25` and accepts clients of `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`. Updating the SDK is a change to review, not a routine bump.
