# Upgrade guide

## Upgrading from version 3 to 4

> This change is relevant for everyone.

Version 4 adds accounts, workspaces and roles, so the data now belongs to a workspace. The server moves your data itself on the first start. There is no migration to run by hand, and no environment variable is new and required: Ackee 4 starts with the same `ACKEE_MONGODB`, `ACKEE_USERNAME` and `ACKEE_PASSWORD` as before.

### Before the upgrade

1. Make a backup of the database. Keep it until you are sure you stay on version 4.

   ```sh
   mongodump --uri="$ACKEE_MONGODB" --archive=ackee-before-4.archive.gz --gzip
   ```

2. Write down the image or the version you run now. You need it to go back.
3. Look through the new [options](Options.md). All of them are optional. Without them, version 4 works like version 3 with one account.

### What the first start does

The first start of version 4 on a database of version 3:

- moves all domains and events into the default workspace. The account of `ACKEE_USERNAME` is its owner;
- drops the old single field indexes `domainId_1` of records and `eventId_1` of actions, because compound indexes replace them;
- builds the hourly and daily rollups of all stored records, so that reports do not read every record.

The server answers requests a few seconds after the start. Rollups are built in the background. Until they are ready, reports read the records, as version 3 did, and only take longer.

In a test on a copy of a version 3.6.1 database with 1,000,020 records over 180 days (Apple M4 Pro, MongoDB 7 in Docker), the server listened 3 seconds after the start, and the rollups were ready after 28 seconds. The time grows with the number of records.

The log shows each step:

```
Moved 1 domains and 1 events into the default workspace
Dropped the old domainId index of records
Dropped the old eventId index of actions
Rollups cover 2026-05-22T12:00:00.000Z to 2026-11-18T00:00:00.000Z
```

Existing tracking snippets keep working. A domain from version 3 accepts views with and without an [ingest key](Options.md#ingest-key) until you turn strict mode on.

### Check after the upgrade

1. The API answers and runs the new version:

   ```sh
   curl -s -X POST https://ackee.example.com/api -H 'Content-Type: application/json' \
     -d '{"query":"{ build { id version database } }"}'
   ```

   The answer has `"database": true` and the version you installed.

2. Sign in with `ACKEE_USERNAME` and `ACKEE_PASSWORD`. Your domains and events are there.
3. Compare a report with the numbers before the upgrade, for example the views of this month. In the test above, all views of this month, this year and the last six months were the same as in version 3.
4. Open your site and check that the view appears in Ackee.

### Going back to version 3

There are two ways. Choose by what you can lose.

**Start the previous image on the same database.** Version 3.6.1 runs on a database that version 4 has migrated. It keeps the views recorded under version 4 and creates its old `domainId_1` index again. It ignores the collections of version 4. Use this way when version 4 runs into a problem, but the data is fine.

**Restore the backup.** Use this way when the data is damaged. Everything recorded after the upgrade is lost. Stop Ackee, drop the database, then restore:

```sh
mongosh "$ACKEE_MONGODB" --eval 'db.dropDatabase()'
mongorestore --uri="$ACKEE_MONGODB" --archive=ackee-before-4.archive.gz --gzip
```

Drop the database first, do not only pass `--drop` to `mongorestore`. `--drop` replaces only the collections that are in the backup. The rollups of version 4 are not in a backup of version 3, so they stay. A later upgrade then trusts them and counts views that are no longer in the database. In the test, a view that was restored away was still counted in the reports.

After either way, start the image of version 3 and run the checks above.

## Upgrading from version 2 to 3

### `Access-Control-Allow-Origin: "*"` not recommended

> This change is relevant for you when using a wildcard as the Access-Control-Allow-Origin.

Using a wildcard (`*`) for the `Access-Control-Allow-Origin` header was never recommended as it's neither a secure solution nor does it allow Ackee to ignore your own visits. Please disable the `ignoreOwnVisits` option in ackee-tracker if you're currently using a wildcard. The [SSL and HTTPS](SSL%20and%20HTTPS.md) guide contains better alternatives.

`ignoreOwnVisits` is now enabled by default and won't work when using a wildcard.

### New `Access-Control-Allow-Credentials` header

> This change is relevant for everyone.

Ackee requires [a new `Access-Control-Allow-Credentials` header](CORS%20headers.md#credentials) which was previously optional. Make sure to add this header in your server or reverse proxy configuration.

### ackee-tracker with new `.create` and `.record` syntax

> This change is only relevant for you when using ackee-tracker in the [Manually](https://github.com/electerious/ackee-tracker/blob/master/README.md#manually) or [Programmatic](https://github.com/electerious/ackee-tracker/blob/master/README.md#programmatic) way.

The [changelog of ackee-tracker](https://github.com/electerious/ackee-tracker/blob/master/CHANGELOG.md) contains everything you need to know when updating to the newest version.

### Referrers require `ReferrerType` in GraphQL API

> This change is relevant for you when using the GraphQL API.

A new parameter is required when requesting referrers via the GraphQL API. The parameter is called `ReferrerType` and can be `WITH_SOURCE`, `NO_SOURCE` or `ONLY_SOURCE`.

### Referrers can return non URL ids via GraphQL API

> This change is relevant for you when using the GraphQL API.

The `id` of requested referrers was always a URL, but has been changed to a string. That's because [referrers can now include parameters](Enhancing%20referrers.md) (e.g. `source` when using `ackee-tracker`).
