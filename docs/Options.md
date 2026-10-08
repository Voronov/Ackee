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

## Email

Confirmation and password reset links are sent over SMTP. Without `ACKEE_SMTP_HOST` no email
is sent at all, and a new account is confirmed straight away, because nobody could open a
link that never arrives.

```
ACKEE_URL=https://ackee.example.com
ACKEE_SMTP_HOST=smtp.example.com
ACKEE_SMTP_PORT=465
ACKEE_SMTP_USER=ackee@example.com
ACKEE_SMTP_PASSWORD=<password>
ACKEE_SMTP_FROM=ackee@example.com
```

`ACKEE_URL` is the public address of this instance; the links in emails are built from it.
Port 465 uses TLS from the start, any other port upgrades with STARTTLS. The settings are
checked once at start-up, so a wrong password shows up in the log rather than when the first
person registers.

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
