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
a dot, and the tracker passes the whole value through untouched – so nothing about the
tracker had to change.

The key is **not a secret**: it sits in a script tag on a public page, and anyone who opens
that page can read it. What it buys is a higher bar. Without it, a domain id found in
someone's page source is enough to send events into their reports; with it, an attacker has
to at least fetch the page, and the owner can rotate the key when that is not enough.

A new domain checks the key from the start, because its embed code already carries it. A
domain that existed before keys accepts events with or without one, so a snippet already on a
site keeps working. Turn checking on once the snippet on your site carries the key:

```graphql
mutation {
  updateDomain(id: "…", input: { title: "example.com", strictIngest: true }) {
    success
  }
}
```

With it on, an event also has to come from the site the domain is named after (the `Origin`
header, subdomains included). That check only works when the domain title is a host name; a
domain called "My blog" cannot be checked that way and is let through.

Rotate a key that is being misused with `rotateIngestKey`. The old one stops working at once,
so update the snippet on your site first.

## Username and password

Username and password. Both are required to generate a new token.

```
ACKEE_USERNAME=username
ACKEE_PASSWORD=password
```

People can also register their own account with an email address and a password. Registering
creates a personal workspace with the new account as its owner. The address must be confirmed
through the emailed link before the account can sign in.

Registration is closed unless you open it:

```
ACKEE_ALLOW_SIGNUP=true
```

It needs outgoing email (see below), because an account that cannot confirm its address can
never sign in. The account from `ACKEE_USERNAME` keeps working either way.

## Email

Confirmation, password reset and invitation links are sent over SMTP. Without
`ACKEE_SMTP_HOST` no email is sent at all. With `NODE_ENV=development` emails are written to the
log instead of being sent, so a link can be opened without a mail server.

Keep the SMTP password in the environment or in an `.env` file, never in the repository.

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

## Redis

Set when more than one Ackee process records views, e.g. replicas or a separate ingest process. The processes then share the daily salt through Redis and compute the same `clientId` for the same visitor. A restart during the day keeps the salt as well. Without this variable every process keeps its own salt in memory.

```
ACKEE_REDIS=redis://redis:6379
```

The salt is stored under `ackee:salt:<date>` and expires after 25 hours. Run Redis without persistence (`--save '' --appendonly no`), so the salt never reaches a disk or a backup. While Redis is unreachable, recording waits for it.

## Demo mode

Set to `true` to enable demo mode. In demo mode, all mutations (creating, updating, deleting) are blocked, and the GraphQL Playground is enabled.

```
ACKEE_DEMO=true
```

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

| Metric                                     | What it answers                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `ackee_http_request_duration_seconds`      | How long requests take, by method, route and status                                                 |
| `ackee_graphql_operation_duration_seconds` | How long GraphQL operations take, by root field — separates the read profile from the write profile |
| `ackee_mongodb_command_duration_seconds`   | How long database commands take, by command and collection, measured by the driver itself           |

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

## Sign in with Google

Ackee can offer "Sign in with Google" next to the password form. It uses OpenID Connect with PKCE and asks Google only for the address (`openid email`).

```
ACKEE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
ACKEE_GOOGLE_CLIENT_SECRET=GOCSPX-...
ACKEE_URL=https://ackee.example.com
```

Create an OAuth client of type "Web application" in the Google Cloud console and add `<ACKEE_URL>/auth/google/callback` as an authorized redirect URI. Without all three variables the button is hidden and `/auth/google` answers 404.

- An address Google has not confirmed is refused.
- An existing account with the same address is linked to the Google account on the first sign-in, and counts as confirmed from then on.
- Someone without an account gets one only when `ACKEE_ALLOW_SIGNUP=true`, with a personal workspace like any registration. Such an account has no password until its owner sets one with "Forgot password".

## Passkeys

Signed-in users can add passkeys (Touch ID, Windows Hello, a security key) under Settings → Passkeys and then sign in without a password. Passkeys need only `ACKEE_URL`:

```
ACKEE_URL=https://ackee.example.com
```

The browser binds every passkey to the host name of `ACKEE_URL`, so a passkey made on one stand never signs anyone in on another, and changing the host name makes existing passkeys unusable. Browsers allow passkeys only over https, or on `localhost` and `*.localhost`.

The password and "Forgot password" keep working as a way back in when a passkey is lost.
