# Live feed

Every domain page has a **Live** card at the top. A visit shows up there as it happens:
the path, where the visitor came from, the country, the browser and the system.

The card is a view of one domain. Open a domain to see it.

## Why there is one

Version 1.0 had a single live number, `activeVisitors`, and the interface asked for it
every five minutes. That is enough to know somebody is there and not enough to know what
they are doing. The feed shows the visits themselves.

## How it works

The browser opens a long-lived HTTP connection to:

```
GET /live/:domainId
```

and the server pushes [server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
down it. Three kinds of message:

| Event   | When                | Data                                      |
| ------- | ------------------- | ----------------------------------------- |
| `open`  | Straight away       | `{ domainId }`                            |
| `visit` | A visit was written | The fields the card shows                 |
| `error` | A read failed       | `{ message }`. The connection stays open. |

A comment line (`: keep-alive`) goes down every 25 seconds, because a proxy closes a
connection that says nothing.

### The token

The route takes the same bearer token as everything else, in an `Authorization` header.
That rules out the browser's own `EventSource`, which cannot send headers, so the
interface reads the stream with `fetch` and parses the few lines of the format itself.

The alternative was a token in the query string. Proxies and access logs keep query
strings, and a permanent token in a log file is a permanent problem.

### Where the visits come from

The server polls. Ingest runs in its own process, so a record written there is not an
event in the API process, and both ways of making it one cost something this project
decided against: [change streams](https://www.mongodb.com/docs/manual/changeStreams/) need
a replica set, and a message queue needs a queue.

Polling `{ domainId, created }` every two seconds is a scan of a few keys on the index the
reports already use. One poll serves every listener on a domain, so ten people watching
the same site is one query, not ten.

The cursor starts at the moment you connect. The feed shows what happens from now on; the
reports are there for what happened before.

## Limits

- At most 20 visits per poll. A burst of traffic does not become a burst of messages; the
  rest arrive on the next poll rather than being skipped.
- The card keeps the last 25 visits.
- A dropped connection is retried after five seconds. The dot next to "Live" is dim while
  it reconnects.
