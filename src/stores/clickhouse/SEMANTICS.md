# ClickHouse store semantics

Where the ClickHouse store deliberately differs from the MongoDB pipeline, and what is known to be imperfect. MongoDB stays the source of truth for every write.

## Versions instead of updates

Rows are never updated in place. Every change MongoDB makes to a record or action (`touchRecord`, `touchAction`, `anonymize`) is inserted as a new row with the same `id` and a higher `version`; `ReplacingMergeTree(version)` keeps the highest one, so reads must use `FINAL`.

`version` is `Date.now()` bumped to be strictly increasing within one process. It is monotonic only inside that process: two instances writing the same `id` can interleave when their clocks differ, and the row with the later clock wins regardless of which write MongoDB applied last.

## Migrated history

`scripts/migrate-to-clickhouse.js` inserts one row per MongoDB document with `version = updated` in milliseconds, whatever the document's history was: a touched record arrives as its final state only. The dual store versions its rows with the clock at push time, which is never earlier than the `updated` it has just written, so a version Ackee wrote is never outranked by the migrated row: for the same change the two tie (same content), and a later change wins.

`anonymize` does not bump `updated`, so a migrated anonymized row carries the `updated` of the last create or touch as its version. The live copy of that create or touch has the same or a higher version, and the live anonymized version a higher one still. The consequences for a backfill after the writer dropped rows (see below) follow from this: a lost create is restored, a lost touch is restored as long as the touch came after the create was pushed (the migrated row then ranks above the surviving create), but a lost anonymization is not, because the migrated anonymized row ranks below the create or touch that survived. The `clientId` of such a record stays in ClickHouse while MongoDB has nulled it. Re-anonymizing from MongoDB is not possible either, MongoDB no longer knows which `clientId` the record had.

With `ACKEE_INGEST_QUEUE=redis` the Redis stream holds a third copy of every event, with its `clientId` and device fields as sent, that no anonymization reaches: the worker trims acknowledged entries after 24 hours, and Redis snapshots (RDB, AOF) of that day are the operator's responsibility, see `docs/Queue.md`, "Privacy".

`clientId` has no column TTL, on purpose. MongoDB keeps the `clientId` on the last record of each visitor and unique views and active visitors are counted on it, so a ClickHouse column that empties itself after a day could never reproduce those numbers. Older records lose their `clientId` in ClickHouse the same way they do in MongoDB, through the anonymized versions above. This keeps the privacy model of MongoDB, not more: a `clientId` is a one-way hash with a daily salt, and ClickHouse holds exactly the ones MongoDB holds, except for the lost-anonymization case.

## Anonymization

`dual.anonymize` reads the visitor's earlier records first, then nulls in MongoDB exactly those ids (`anonymizeByIds`) and pushes one anonymized version per read record. Both stores therefore agree at every moment: a record created between the read and the update keeps its `clientId` in both and is anonymized by the visitor's next event. Because that record's `clientId` is not touched, the next read finds it.

Known gap without the queue: `touchRecord` reads the full record from MongoDB and pushes it as a version. When an `anonymize` update lands in the few milliseconds between that read and the push, the touch version is pushed with the pre-anonymization fields and a higher `version` than the anonymized one, and it wins in ClickHouse while MongoDB is anonymized. With `ACKEE_INGEST_QUEUE=redis` and a single worker (see `docs/Queue.md`) the writes of one visitor are processed one after the other in the order the tracker sent them, so a touch and an anonymization never overlap and the gap is closed. With several workers reading the same stream they interleave again and the gap is back; a redelivery after a worker crash is also replayed behind messages that arrived since.

## Deletes while ClickHouse is unreachable

`deleteRecords` and `deleteActions` run `ALTER TABLE ... DELETE` once, after a flush. When ClickHouse is unreachable the error is logged and nothing retries: the rows of the deleted domain or event stay in ClickHouse. They are invisible to reports, which join on metadata that no longer exists, but they still hold visit data, which matters for privacy. Re-running the delete is a manual step.

## Buffer overflow

The writer keeps at most 50000 rows. Beyond that new rows are dropped, and after a failed insert the requeued batch is cut to what fits; in both cases the oldest rows survive. Any drop breaks parity with MongoDB for the affected rows, the counter in `writer.stats.dropped` says how many, and only a backfill from MongoDB (`scripts/migrate-to-clickhouse.js --reset`) restores it. A backfill restores dropped creates and touches but not dropped anonymizations, see "Migrated history".

## Overhead of dual writes

`dual` is a transitional mode: MongoDB does its usual writes plus one extra read (and one extra `updateMany` when the visitor has earlier records) per `createRecord`, while the ClickHouse insert itself is buffered and off the request path. An increase of up to 30 % in p95 latency over `mongo` is accepted for this mode.

## Dates

`created` and `updated` are `DateTime64(3)` and are written as ISO strings with milliseconds and a zone. A plain millisecond number in `JSONEachRow` would be read by ClickHouse as seconds.

## Reports

What each MongoDB pipeline in `src/aggregations/*.js` and `src/database/*.js` does, and how the SQL in `src/stores/clickhouse/reports/` mirrors it. Every query reads `FROM records FINAL` (or `actions FINAL`) so that the latest version of a row is the only one seen: a touched record contributes its last `updated`, an anonymized record has `clientId = ''` and NULL in the twelve anonymized fields, and `IS NOT NULL` drops it exactly where MongoDB's `$ne: null` does.

### Time

`dateDetails` (`src/utils/createDate.js`) is built once per request from the `Time-Zone` header and `new Date()` on the server; both stores receive the same object, so every bound below is the same `Date` in both.

- Ranges (`TOP` sorting and the actions `TOP` list only; `NEW` and `RECENT` ignore the range): `LAST_24_HOURS` = `created >= now - 24 h`; `LAST_7_DAYS` = `created >= subDays(now, 7)`; `LAST_30_DAYS` = `subDays(now, 30)`; `LAST_6_MONTHS` = `subMonths(now, 6)`. `subDays`/`subMonths` are calendar arithmetic in the server time zone, measured from `now`, not from the start of the day. No upper bound.
- Intervals (`views`, `durations`, actions chart): the lower bound is `includeDays(limit)` = `startOfDay(now)` in the server time zone, minus `limit - 1` days, minus 14 hours (the largest UTC offset, so the first bucket is complete in any user time zone); `includeMonths`/`includeYears` likewise with `startOfMonth`/`startOfYear`. The extra rows are dropped when the buckets are filled.
- Grouping is by `(day, month, year)`, `(month, year)` or `(year)` of `created` in the **user** time zone (`$dayOfMonth`/`$month`/`$year` with `timezone`). ClickHouse: `toDayOfMonth(created, {tz})`, `toMonth`, `toYear` with the same IANA name. Both use the tz database, so DST rules agree. `createDate.js` also lets fixed UTC offsets through (`+02:00`, `+0530`, `+05`, everything `Intl` accepts), which MongoDB's `timezone` takes as they are and ClickHouse rejects (`Cannot load time zone`); for those the store groups `addMinutes(created, offset)` in `UTC`, which is the same shift.
- Buckets: the store returns exactly `limit` entries, index 0 = the current unit, index `i` = `lastDays(i)` (`subDays(now, i)` in the server time zone), each matched against the grouped rows through `toZonedTime(date, userTimeZone)`; a unit with no rows has `count: 0`. `value` is `YYYY-M-D`, `YYYY-M` or `YYYY` of the **server-local** date (upstream quirk, kept). The ClickHouse store fills its buckets with the same algorithm, copied from `src/database/views.js` into `reports/intervals.js` (the upstream file keeps its own copy), only the grouped rows come from SQL.

### Result shape

Every report returns an array of plain objects with the same keys and types as the MongoDB implementation:

- `views`, `durations`, `actionsChart`: `{ id, value, count }`, `count` a `Number` (`durations` and the `AVERAGE` chart are floats).
- `pages`, `referrers`, `systems`, `devices`, `browsers`, `sizes`, `languages`, `actionsList`: `{ id, value, count, created }`. `TOP` has `created: undefined`, `RECENT` has `count: undefined`, `NEW` has both; the keys are present with `undefined`, as in MongoDB. `created` is a `Date`. `id` is `recursiveId([value, sorting, (type,) range, ...ids])`, computed by the same function.
- `activeVisitors`: a `Number`.

64-bit integers (`count()`, `toUnixTimestamp64Milli`) are returned as JSON numbers (`output_format_json_quote_64bit_integers = 0`), never as strings; report counts are far below 2^53.

### views

Filter: `domainId IN ids`, `created >= includeFn(interval)(limit)`; `UNIQUE` adds `clientId` exists and `!= null` → `clientId != ''`. Group by interval, `count()`. Fill buckets as above. `TOTAL` counts every record, `UNIQUE` counts records that still carry a `clientId`, which after anonymization is the last record of each visitor.

### durations

Filter: `domainId IN ids`, `created >= includeFn(interval)(limit)`. `duration = updated - created` in milliseconds; when `duration < 15000` (`DURATIONS_INTERVAL`) it becomes `7500`; rows with `duration >= 1800000` (`DURATIONS_LIMIT`, 30 minutes) are dropped **after** that substitution. Group by interval, `count = avg(duration)`. ClickHouse computes `toUnixTimestamp64Milli(updated) - toUnixTimestamp64Milli(created)` (Int64) and `sum(duration) / count()`: an exact integer sum divided once, which is also what MongoDB's `$avg` does for integer input, so the floats agree bit for bit.

### pages, referrers, systems, devices, browsers, sizes, languages

One record property set per report (`siteLocation`; `source`+`siteReferrer`, `siteReferrer` or `source`; `osName` [+ `osVersion`]; `deviceManufacturer` [+ `deviceName`]; `browserName` [+ `browserVersion`]; `browserWidth`/`browserHeight`/`screenWidth`/`screenHeight` alone or as a pair; `siteLanguage`).

- Null handling: every property must be `!= null` (`IS NOT NULL`); with several properties all of them (so `Linux` without `osVersion` is absent from `WITH_VERSION`). `referrers WITH_SOURCE` is the exception: `source != null OR siteReferrer != null`, grouped by both, value = `source || siteReferrer`.
- `TOP`: filter by range, group by the properties, `count = count()`, `ORDER BY count DESC`, `LIMIT limit`.
- `NEW`: no range. Sort by `created` ascending, group by the properties, `count = count()`, `created` = `$first: '$created'`, then `ORDER BY created DESC`, `LIMIT limit`. ClickHouse: `min(created)`. The sort before the group is the one deliberate change to the v3.6.1 pipeline (`src/aggregations/aggregateNewRecords.js`, `aggregateNewActions.js`): `$first` without it takes the first document the query plan meets, which was insertion order, so the oldest record of the group, with the single `domainId_1` index of v3.6.1, but became undefined once the compound index `{ domainId: 1, created: -1 }` existed: the planner then picks either index and `$first` is either the oldest or the newest record, depending on the trial run and the plan cache. With the sort `$first` is `min(created)`, "entries that appeared for the first time" as the GraphQL schema documents `NEW`, and both stores agree row for row. The sort costs nothing extra: the compound index serves it as a backward index scan (one scan per id, merged with `SORT_MERGE`), there is no in-memory `SORT` stage.
- `RECENT`: no range, no grouping: `ORDER BY created DESC LIMIT limit`, one row per record, `count` undefined. Repeated values are expected.
- Ties: MongoDB sorts `count DESC` (or `created DESC`) without a secondary key and picks any of the tied rows at the `limit` boundary; ClickHouse does the same. Two stores agree on every row above the boundary and on the multiset of counts; which of the tied rows sits at the boundary is undefined in both. The parity test checks exactly that.
- `sizes` values are `${width}px`, `${width}px x ${height}px`; `languages` maps the code through `languageCodes`; `systems`/`devices`/`browsers` join name and version/model with a space, all via the same code as MongoDB.

### activeVisitors

`domainId IN ids`, `clientId != ''`, `created >= now - 30 min` (`DURATIONS_LIMIT`), `updated >= now - 30 s` (`DURATIONS_INTERVAL * 2`), `count()`. MongoDB's `$count` yields no row for zero, the store returns `0`; ClickHouse returns `0` directly.

### actions

- Chart (`actionsChart`): `eventId IN ids`, `created >= includeFn(interval)(limit)`, no `key` filter. Group by interval; `TOTAL` = `$sum: '$value'`, `AVERAGE` = `$avg: '$value'`, both ignore `null` values. `$sum` of nothing is `0`, so ClickHouse uses `coalesce(sum(value), 0)`; `$avg` of nothing is `null` in both. `value` is `Float64`: for integer values both sums are exact; for fractional values MongoDB uses compensated summation and ClickHouse a plain one, so the last bits can differ.
- List `TOP`: `key != null`, range filter, group by `key`, `count` = sum or avg of `value`, `ORDER BY count DESC LIMIT limit`.
- List `NEW`: `key != null`, sort by `created` ascending, group by `key`, `count = sum(value)` (also for `AVERAGE`, as in MongoDB), `created` = `$first`, which is `min(created)` after that sort (same deliberate change as for records, served by `{ eventId: 1, created: -1 }`), `ORDER BY created DESC LIMIT limit`.
- List `RECENT`: `key != null`, `ORDER BY created DESC LIMIT limit`, one row per action.

### FINAL

`FINAL` makes ClickHouse deduplicate across parts at read time, and it is not optional: on 1M records with 100k unmerged touch versions in 50 parts, `views` over 30 days counts 554499 without it and 504099 with it. It costs about 25 ms on that table (`views` 30 days: 14 ms without, 39 ms with; `browsers` 30 days: 16 ms and 37 ms, medians of 10 runs), whether or not duplicates are present. Rows of one record share `(domainId, created, id)` and therefore the month partition, so `do_not_merge_across_partitions_select_final = 1` is safe and is set on every report query; with the three partitions of that test it made no measurable difference (within 1 ms), its benefit is for tables with many months of data, where partitions are then processed independently and in parallel.
