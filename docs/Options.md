# Options

The following environment variables are used by Ackee. You can also create a `.env` file in the root of the project to store all variables in one file. Ackee uses Node.js native [--env-file](https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs) support.

- [Database](#database)
- [Port](#port)
- [Username and password](#username-and-password)
- [TTL](#ttl)
- [Tracker](#tracker)
- [Environment](#environment)
- [Demo mode](#demo-mode)
- [CORS headers](#cors-headers)

## Database

MongoDB connection URI. See the [MongoDB connection string spec](https://docs.mongodb.com/manual/reference/connection-string/) for more detail.

```
ACKEE_MONGODB=mongodb://localhost:27017/ackee
```

_or_

```
MONGODB_URI=mongodb://localhost:27017/ackee
```

## Port

The port Ackee should listen on. Defaults to `3000`.

```
ACKEE_PORT=3000
```

_or_

```
PORT=3000
```

## Ingest key

Every domain has an ingest key. The embed code carries it after the domain id, separated by
a dot, and the tracker passes the whole value through untouched — so nothing about the
tracker had to change.

The key is **not a secret**: it sits in a script tag on a public page, and anyone who opens
that page can read it. What it buys is a higher bar. Without it, a domain id found in
someone's page source is enough to send events into their reports; with it, an attacker has
to at least fetch the page, and the owner can rotate the key when that is not enough.

Checking is off per domain until the owner turns it on, so an installation that predates
this keeps working. Turn it on once the snippet on your site carries the key:

```graphql
mutation {
  updateDomain(id: "…", input: { title: "example.com", strictIngest: true }) {
    success
  }
}
```

With it on, an event also has to come from the site the domain is named after. That check
only works when the domain title is a host name; a domain called "My blog" cannot be checked
that way and is let through.

Rotate a key that is being misused with `rotateIngestKey`. The old one stops working at once,
so update the snippet on your site first.

## Secret

Encrypts credentials that people hand over, which so far means the Google service account
key used to sync Analytics.

```
ACKEE_SECRET=<random string>
```

Without it, connecting an Analytics property is refused rather than storing the key in a
readable form. Changing it makes existing keys unreadable, and those connections have to be
made again.

## Registration

Accounts live in the database and are created by registering, not by configuration.
`ACKEE_USERNAME` and `ACKEE_PASSWORD` are gone.

Registering creates a personal workspace along with the account. Domains belong to a workspace
rather than to a user, so without one a new account would have nowhere to put a domain. A single
user never sees this: for them it is simply "my domains". Everyone who registers gets the same
thing — their own workspace, their own domains, and no view of anyone else's.

Registration is open unless you close it:

```
ACKEE_ALLOW_SIGNUP=false
```

Close it when the instance exists to measure your own sites and nobody else should be able to
create an account on it. Note that closing it leaves no way to add the first account either, so
set it after you have registered.

## TTL

Specifies how long a generated token is valid. Defaults to `86400000` (1 day).

```
ACKEE_TTL=86400000
```

## Tracker

Pick a custom name for the tracking script of Ackee to avoid getting blocked by browser extensions. The default script will always be available via `/tracker.js`. Your custom script will be available via `/custom%20name.js`. Ackee will encode your custom name to a URL encoded format. Avoid characters that can't be used in filenames.

Make sure to adjust the tracking script URL on your sites when changing this option. Sites that are using the default URL won't be affected.

```
ACKEE_TRACKER=custom name
```

## Environment

Set the environment to `development` to see additional details in the console and to disable caching.

```
NODE_ENV=development
```

## Demo mode

Set to `true` to enable demo mode. In demo mode, all mutations (creating, updating, deleting) are blocked, and the GraphQL Playground is enabled.

```
ACKEE_DEMO=true
```

## Country

Resolve the country of each visit from the IP address and store the two-letter code with the record.

```
ACKEE_GEO=true
```

Off by default. The lookup uses a database shipped with Ackee (`@ip-location-db`, CC0), so no request leaves your server and no account or API key is needed. The IP is used for the lookup and discarded — it is never stored, just as it already was for the visitor hash.

Adds a `countries` report to the API. Records written before the variable was enabled have no country and are simply absent from that report.

See [Anonymization](Anonymization.md#country) before turning this on: a country next to a browser version, an OS version and an exact screen size is close to a fingerprint. City-level resolution is deliberately not offered.

## Event store

Which store answers reports and takes writes.

```
ACKEE_EVENT_STORE=mongo
```

- `mongo` — the default. MongoDB alone, exactly as version 1.0 behaved.
- `dual` — every event is written to both stores, reports are still answered by MongoDB. A
  failed ClickHouse insert is logged and never rejects the event.
- `clickhouse` — reports are answered by ClickHouse.

`dual` is the step to sit on while the columnar store fills up. Moving back to `mongo` is an
environment change, not a data migration.

`clickhouse` requires the ClickHouse settings below and **does not fall back to MongoDB**:
reports answer from the columnar store alone, so history that was never copied over simply
reads as zero. Run the migration before switching.

See [ADR-006](adr/ADR-006-event-store.md) for why the choice is made here rather than inside
each report, and [ClickHouse](ClickHouse.md) for what the store guarantees.

## ClickHouse

Connection for the `dual` and `clickhouse` stores.

```
ACKEE_CLICKHOUSE=http://clickhouse:8123
ACKEE_CLICKHOUSE_USER=ackee
ACKEE_CLICKHOUSE_PASSWORD=<password>
ACKEE_CLICKHOUSE_DATABASE=ackee
```

Ackee creates the database and the tables itself on the first start, so an empty server is
enough.

Copy existing history over before serving reports from it:

```
npm run clickhouse:migrate
```

The migration keeps a checkpoint, so an interrupted run resumes instead of starting over.
`--dry-run` reports what it would copy, `--from` limits it to a date, and `--reset` starts
again from scratch.

Unlike the arrangement ADR-004 described, the columnar store holds the visitor hash, so
unique views and active visitors are answered from it rather than handed back to MongoDB.
Anonymization is mirrored as a new version of the row instead of rewriting history. See
[Anonymization](Anonymization.md) for what that means for retention.

Rollups are unaffected: they run over MongoDB and keep serving the `mongo` and `dual` stores.

## Ingest queue

Accept an event, put it on a queue and let a separate worker store it, so a slow store cannot
slow the tracker down.

```
ACKEE_INGEST_QUEUE=redis
ACKEE_REDIS_URL=redis://redis:6379
ACKEE_REDIS_STREAM=ackee:events
```

Off by default (`none`). The record is validated while the tracker is still waiting, so a
malformed event is still rejected with the same error as before; only the write moves.

Delivery is at-least-once, which is why a touch never shortens a visit. Run the worker with
`npm run worker:ingest`. See [Queue](Queue.md) for its limits.

## Rollups

Serve the top reports (pages, referrers, systems, devices, browsers, sizes, languages) from pre-computed hourly rollups instead of scanning raw records on every request.

```
ACKEE_ROLLUPS=true
```

Enabling this starts a worker that refreshes the last two hours every five minutes. Existing history has to be rolled up once:

```
npm run rollup:backfill
```

Reads stay correct while the backfill is incomplete: a report whose time window is not fully covered by the built rollups falls back to the raw records automatically. Turning the variable back off restores the 1.x read path immediately — no data migration is involved either way.

Two reports are never served from rollups. `views` with `type: UNIQUE` counts distinct clients, which cannot be summed across buckets, and `durations` averages per-record values; both keep reading raw records, where the `{ domainId, created }` index serves them.

## Metrics

Ackee exposes Prometheus metrics at `/metrics` when a token is set. Without this variable the endpoint responds with `404 Not found`, and so does any request carrying a wrong token — the endpoint never confirms that it exists.

```
ACKEE_METRICS_TOKEN=<random string>
```

Scrape it with an `Authorization` header:

```
curl -H 'Authorization: Bearer <token>' https://ackee.example.com/metrics
```

Exposed series, next to the Node.js defaults:

| Metric                                     | What it answers                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ackee_http_request_duration_seconds`      | How long requests take, by method, route and status                                                                                                       |
| `ackee_graphql_operation_duration_seconds` | How long GraphQL operations take, by root field — separates the read profile from the write profile                                                       |
| `ackee_mongodb_command_duration_seconds`   | How long database commands take, by command and collection, measured by the driver itself                                                                 |
| `ackee_rollup_build_duration_seconds`      | How long one day of rollups takes to build, split into `backfill` and `refresh`                                                                           |
| `ackee_rollup_lag_seconds`                 | How far the worst-covered domain lags behind now — a growing value means the worker is falling behind and reports are quietly falling back to raw records |

## CORS headers

Quick solution for setting [CORS headers](CORS%20headers.md) instead of using a [reverse proxy](SSL%20and%20HTTPS.md). This is helpful if you are running Ackee on a platform that handles SSL for you.

```
ACKEE_ALLOW_ORIGIN=https://example.com
```

_or_

```
ACKEE_ALLOW_ORIGIN=https://example.com,https://one.example.com,https://two.example.com
```

Setting a wildcard (`*`) is also supported, but not recommended. It's neither a secure solution nor does it allow Ackee to ignore your own visits. Please disable the `ignoreOwnVisits` option in ackee-tracker if using a wildcard is the only option for you.

```
ACKEE_ALLOW_ORIGIN=*
```

As opposed to manually configuring CORS domains, you can also automatically add CORS Headers for domains in the domain list that have [fully qualified domain names](https://en.wikipedia.org/wiki/Fully_qualified_domain_name) as titles. To achieve this, set:

```
ACKEE_AUTO_ORIGIN=true
```
