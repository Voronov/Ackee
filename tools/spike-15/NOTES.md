# Spike ACKEE-15: notes for the decision

What the preparation of the three variants found, before the measurements. Numbers are from the stand of ACKEE-2 on 18.10.2026 (10M records, one domain, data from 18.08 08:54 to 17.10 08:54 UTC). The preparation ran with other containers in the Docker VM (`metrix-dev-*`, `ripple-hawkes-ua-db-test-1`, about 7 % CPU and 2.2 GiB together, idle), unlike the measurement protocol.

## Preparation cost

| Variant | Step                                                                | Time                         | Result                                       |
| ------- | ------------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| A       | `src/rollups/backfill.js`, 62 days in one-day chunks, 22 dimensions | 292 s                        | 1 599 909 rollup documents                   |
| B       | `scripts/migrate-to-clickhouse.js`, batches of 10 000               | 275.7 s                      | 10 000 000 rows, counts equal in both stores |
| C       | `mv.js setup`: `INSERT … SELECT … FROM records FINAL` per view      | 0.7 s views, 1.9 s referrers | 1 441 and 819 034 rows                       |

Peak memory during the steps (`docker stats`, every 20–30 s): `ackee-bench-mongo` 2.14 GiB of 3 GiB during the backfill, 2.06 GiB during the migration; `ackee-bench-clickhouse` 0.9 GiB during the migration, 1.07 GiB after the views were filled, of 2 GiB.

## Disk

| What                                | Data      | On disk   | Indexes   |
| ----------------------------------- | --------- | --------- | --------- |
| MongoDB `records` (v1.0, unchanged) | 4 808 MiB | 1 764 MiB | 2 417 MiB |
| MongoDB `rollups` (A)               | 395 MiB   | 95 MiB    | 121 MiB   |
| ClickHouse `records` (B), 18 parts  | 2 141 MiB | 1 164 MiB | –         |
| ClickHouse `views_hourly` (C)       | 0.1 MiB   | < 0.1 MiB | –         |
| ClickHouse `referrers_hourly` (C)   | 60 MiB    | 2 MiB     | –         |

`source|siteReferrer:or` alone has 819 034 of the 1.6M rollup documents: the seed combines sources and referrers into about 570 groups an hour. A 30-day `TOP` read of A sums about 410 000 of them, which is why referrers stay the slow report of A (ADR-004 saw the same with p95 749 ms).

## Parity

`parity.js` (data layer, one fixed now) and `parity-api.js` (GraphQL against the stand's v1.0 at the same moment) agree on all four reports for A, B and C, in `UTC` and `Europe/Kiev`. Interval reports agree entry by entry, `TOP` referrers on every row above the lowest count and on the multiset of counts. Durations agree as floats, bit for bit.

The 30-day window has moved since the baseline of 17.10: `views TOTAL` counts 4 728 579 records on 18.10 (UTC) instead of 4 895 245, and loses about 167 000 a day while the stand is not seeded again. v1.0 and the variants have to be measured on the same day for the numbers to compare.

## A: unique views for closed days

Rollups can carry unique views: a unique view is a record that still has a `clientId`, and that count sums across buckets. What breaks it is time: the next visit of the same visitor on the same day anonymizes their earlier records of that day, so the buckets of the running day still shrink. A day is final once the salt has changed (midnight in the server's zone, `src/utils/salt.js`) and its buckets were rebuilt after that.

The prototype (`ACKEE_ROLLUPS_UNIQUE`): dimension `__uniqueViews`, `sealed` in `RollupState`, backfill seals every day before today, the worker rebuilds the day that ended since the last seal. Rollups answer up to `sealed`, raw records the running day. Tests in `test/rollups/uniqueAndDurations.js`, among them the case of a day anonymized after its buckets were built.

Condition for the seal to be correct, which the prototype does not check: with `ACKEE_INGEST_QUEUE=redis` the `clientId` is computed when the tracker sends the event, with the salt of that moment, but the worker (`src/worker.js`, `record.create`) anonymizes when it processes the event. A visit at 23:59 of day D that waits in the stream, or comes back as a redelivery, is processed after midnight, after the first worker pass has sealed D, and anonymizes earlier records of D. The sealed `__uniqueViews` of D then stay too high for good; the two-hour overlap of the worker does not reach back to them. A day may be sealed only once the stream holds no event from before its midnight: the pending entries and the consumer lag of the stream checked before sealing, or a delay of the seal by more than the largest lag the queue allows. Without the queue the write runs inside the request and the gap is the length of one request. The estimate for ACKEE-8 has to include this check.

On the stand the running day has no records, so A reads nothing raw. On a live site the raw part grows to a whole day by midnight. One full day of the stand (166 667 records, 113 029 with a `clientId`) takes 285 ms median, 786 ms cold (`tail-cost.js`, v1.0 indexes, single requests). That is close to the 300 ms target by itself, before any concurrency; the rollup part adds about 20 ms.

Ways to make the running day cheaper, for ACKEE-8:

- Rebuild the running day's unique buckets on every worker pass (one day of `$facet`, about 5 s on the stand by the backfill rate) and read rollups up to the current hour. Exact up to the last pass, stale by up to five minutes.
- A compound index `{ domainId, created }` (ACKEE-7) does not help here: on one domain it gives the same range as `{ created: 1 }`, and it does not cover `clientId`, so every document of the day is still read.

## A: durations

The prototype (`ACKEE_ROLLUPS_DURATIONS`): dimension `__durations` with `sum` and `count` after the same stages as `aggregateDurations`; the average is `sum / count`, which is the float `$avg` yields. It costs one more facet in the same backfill pass (1 441 documents) and one read of 720 documents per report; parity is exact.

One semantic gap: a duration grows while the visitor stays, and a record whose duration passes 30 minutes drops out of the report. Both happen within half an hour of `created`, inside the two hours the worker rebuilds on every pass. Only a record touched again more than two hours after a quiet spell (a laptop waking up) changes after its bucket was closed; raw records then drop it and the rollup keeps it.

Size of the prototype: model field, one facet, one read path, the seal for unique views, seven tests — about 200 changed lines in `src/` without tests, the autoIndex switch included.

## C: correctness on live data

On the stand C equals B because the migration inserted one row per record. On a live site it would not:

- A materialized view runs on `INSERT` only, and B never updates a row: every touch (`touchRecord`, every 15 s while a page is open) and every anonymization is a new row version. `views_hourly` and `referrers_hourly` would count versions, not records. `FINAL` cannot help, it applies to the source table, not to what the view has already aggregated.
- Deleting a domain runs `ALTER TABLE records DELETE`, which does not reach the views either.

What would make C correct, from cheapest to dearest:

1. **Insert-only facts.** `TOTAL` views and every `TOP` report group by fields that a touch or an anonymization never change (`siteLocation`, `siteReferrer`, `source`; the anonymized fields are device, browser, screen and language). A column that marks the creating version (`kind` or `isCreate`, set by `addRecord` and by the migration) and `WHERE isCreate` in the view make them exact. Writes stay as they are. Also needed: the flag in the schema and the migration, the views in `ensureSchema`, the hybrid read for the window edges (as `variantC.js` does), deletes for the views, parity tests on live writes.
2. **Unique views with signed counts.** Count `+1` for a creating version with a `clientId` and `-1` for every anonymized version (`dual.anonymize` pushes one per record it nulls). Exact only if every version reaches ClickHouse exactly once: the writer retries a failed batch, and a retried block counts twice unless block deduplication covers the views too. That is a new correctness dependency B does not have, because `ReplacingMergeTree` folds duplicates.
3. **Per-record state** (`AggregatingMergeTree` with `argMax` by version, keyed by record) is exact but as large as `records` itself, so it gains nothing over B.

Durations have no view in C by design (`updated` changes after the insert) and are answered as in B.
