# ClickHouse

Ackee can keep visit records and event actions in ClickHouse and answer every report from there. MongoDB stays the source of truth for writes and holds all metadata (domains, events, tokens). The mode is chosen with `ACKEE_EVENT_STORE`, see [Options](Options.md#event-store).

## Modes

| `ACKEE_EVENT_STORE` | Writes                 | Reads      |
| ------------------- | ---------------------- | ---------- |
| `mongo` (default)   | MongoDB                | MongoDB    |
| `dual`              | MongoDB and ClickHouse | MongoDB    |
| `clickhouse`        | MongoDB and ClickHouse | ClickHouse |

## Switching on

1. Start ClickHouse (for development: `docker compose -f docker-compose.dev.yml up -d`).
2. Run Ackee in `dual` mode so that new events reach both stores:

   ```
   ACKEE_EVENT_STORE=dual ACKEE_CLICKHOUSE=http://localhost:8123 npm run server
   ```

3. Copy the history with `scripts/migrate-to-clickhouse.js`, see the [Upgrade guide](Upgrade%20guide.md#migrating-events-to-clickhouse). It ends with the record and action counts of both stores; they must match.

4. Restart with `ACKEE_EVENT_STORE=clickhouse`. Every report is now read from ClickHouse.

## How reads work

Rows in ClickHouse are never updated. A touched or anonymized record is inserted again with the same `id` and a higher `version`, and the tables are `ReplacingMergeTree(version)`. Reports therefore read `FROM records FINAL`, which returns only the latest version of each row. Every report mirrors the MongoDB pipeline it replaces, including the null handling of anonymized records and the time zone of the user; the details and the known differences are in [`src/stores/clickhouse/SEMANTICS.md`](../src/stores/clickhouse/SEMANTICS.md).

## Rollback

To stop reading from ClickHouse, set `ACKEE_EVENT_STORE=dual` and restart. Reports come from MongoDB again, which has every record, and ClickHouse keeps receiving every write, so going back to `clickhouse` later is again just a restart.

`ACKEE_EVENT_STORE=mongo` is the rollback for when ClickHouse itself is unavailable or is being removed. It is as safe and as immediate, but ClickHouse then misses everything that happens meanwhile, and returning to `clickhouse` after a period in `mongo` is not a restart:

- New records and actions are copied by running the migration again (it continues from its checkpoint).
- Records touched in the meantime are only copied by a run with `--reset`, which walks the whole history again.
- Anonymizations made in the meantime are not copied by either run: the anonymized row from the migration does not outrank the row ClickHouse already holds, so those `clientId`s stay in ClickHouse (see "Migrated history" in [`SEMANTICS.md`](../src/stores/clickhouse/SEMANTICS.md)). The only way to bring them over is to drop the ClickHouse database (`DROP DATABASE ackee`) and run the migration with `--reset`; the script recreates the tables.

Either way, follow "Switching on" again from step 2 and compare the counts before switching reads back.

## Metrics

With `ACKEE_METRICS_TOKEN=<token>` Ackee serves Prometheus metrics at `GET /metrics` (see [Options](Options.md#metrics)). The endpoint has no authentication, which is what Prometheus expects; keep it off the public internet. The counters live in memory and start at zero on every restart, which is how Prometheus counters are meant to work.

| Metric                                 | Type      | Meaning                                                                                                         |
| -------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `ackee_records_created_total`          | counter   | Records created through the API (ignored own visits are not counted)                                            |
| `ackee_actions_created_total`          | counter   | Actions created through the API                                                                                 |
| `ackee_clickhouse_buffer_rows`         | gauge     | Rows waiting in the write buffer; grows while ClickHouse is slow or down, 50000 is the limit                    |
| `ackee_clickhouse_flush_seconds`       | histogram | Duration of one insert batch (retry included); `_bucket`, `_sum`, `_count`                                      |
| `ackee_clickhouse_insert_errors_total` | counter   | Insert batches that failed twice, plus mirrored writes that threw (`writer.stats.errors`)                       |
| `ackee_clickhouse_dropped_rows_total`  | counter   | Rows dropped because the buffer was full (`writer.stats.dropped`); any value above 0 means a backfill is needed |
| `ackee_report_seconds{report,store}`   | histogram | Time to answer a report, per report (`views`, `pages`, …, `actionsList`) and store (`mongo` or `clickhouse`)    |

In `mongo` mode the ClickHouse metrics stay at zero and every report is labelled `store="mongo"`; in `dual` mode reports are also `store="mongo"`, because reads come from MongoDB, while the buffer and flush metrics are live. The `ackee_queue_*` metrics of the ingestion queue are listed in [Queue](Queue.md#metrics).

Useful queries:

```
rate(ackee_records_created_total[1m])
histogram_quantile(0.95, sum(rate(ackee_clickhouse_flush_seconds_bucket[5m])) by (le))
rate(ackee_report_seconds_sum[5m]) / rate(ackee_report_seconds_count[5m])
increase(ackee_clickhouse_dropped_rows_total[1h]) > 0
```

`docker-compose.dev.yml` ships Prometheus and Grafana with a ready dashboard behind the `metrics` profile, see [Development](Development.md#metrics).

## CI

`.github/workflows/test.yml` has two jobs. `test` runs `npm test` (lint and the MongoDB tests via `mongodb-memory-server`) on the Node and OS matrix. `clickhouse` runs `npm run test:ch` (`test/clickhouse/` and `test/queue/`) on Ubuntu with the same `clickhouse/clickhouse-server` and `redis:7` service containers as `docker-compose.dev.yml` (ports 8123 and 6379, `CLICKHOUSE_SKIP_USER_SETUP=1`, health checks), so a test that passes locally passes there under the same conditions. `test/workflows.js` parses the workflow and checks that the two jobs and the services stay in line with the compose file.
