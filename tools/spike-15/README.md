# Spike ACKEE-15: three storage variants on the benchmark stand

Run book for the comparison of ACKEE-15. The stand is the one of ACKEE-2 (`docker-compose.bench.yml` in `develop`, 10M records, one domain); this branch adds its own Ackee next to it. Nothing here is merged: the branch `spike/ACKEE-15-clickhouse` is kept in Voronov/Ackee as an archive. Its base is ba11d3c1, the head of `feature/clickhouse-ingest` at the time. The decision is ADR-004 (`docs/adr/ADR-004-clickhouse-decision.md`) and the section «Порівняння сховищ» of `docs/engineering/benchmark-stand.md`, both in `develop`; the raw numbers behind them are in `results/` here.

| Variant | What                                                          | Where                                                        |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| v1.0    | MongoDB, raw records                                          | the stand's own Ackee, `develop`, :3100                      |
| A       | MongoDB with hourly rollups                                   | `ackee-bench-ackee-a`, :3200, `ACKEE_ROLLUPS=true`           |
| B       | ClickHouse, raw tables with `FINAL`                           | `ackee-bench-ackee-b`, :3300, `ACKEE_EVENT_STORE=clickhouse` |
| C       | ClickHouse with hourly materialized views for views/referrers | SQL only, `variantC.js`; durations as in B                   |

## What A reads from rollups

As in the branch: views `TOTAL` and every `TOP` report. Added by the spike, behind flags that `ackee-a` takes from `BENCH_ROLLUPS_UNIQUE` and `BENCH_ROLLUPS_DURATIONS` (on unless set) and that are off everywhere else:

- `ACKEE_ROLLUPS_UNIQUE`: unique views. A record counts while it carries a `clientId`, which sums across buckets, but a later visit of the same visitor on the same day anonymizes their earlier records, so a bucket is final only once its day is over (the salt changes at midnight in the server's zone). Rollups answer up to `sealed` in `RollupState`, raw records the rest. Backfill seals every day before today; the worker rebuilds the day that ended since the last seal. On the stand the data ends on 17.10, so the raw part is empty: on a live site it is up to one day of records, measure it separately.
- `ACKEE_ROLLUPS_DURATIONS`: durations. Buckets keep `sum` and `count` of the durations after the same stages as `aggregateDurations`, the average is `sum / count`, which is the float `$avg` yields.

A is measured in two modes, each a restart of `ackee-a` with its flags:

| Mode                    | Flags                                                      | Unique views and durations                                       |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| A (branch)              | `BENCH_ROLLUPS_UNIQUE=false BENCH_ROLLUPS_DURATIONS=false` | raw records, as in `feature/clickhouse-ingest`                   |
| A+ (prototype of spike) | `BENCH_ROLLUPS_UNIQUE=true BENCH_ROLLUPS_DURATIONS=true`   | rollups; report it together with the raw day from `tail-cost.js` |

```sh
BENCH_ROLLUPS_UNIQUE=false BENCH_ROLLUPS_DURATIONS=false docker compose -f docker-compose.spike.yml up -d ackee-a   # A (branch)
docker compose -f docker-compose.spike.yml up -d ackee-a                                                          # A+
```

The seal of unique views in A+ is not safe behind the ingest queue yet, see "A: unique views for closed days" in `NOTES.md`; the stand has no queue.

A falls back to raw records without a word when the rollups do not cover the window up to the current hour. The worker of `ackee-a` keeps them current every five minutes; `parity.js` refuses to call a raw answer an A answer.

## Prepare

From `ackee/` (develop) for the stand, from this directory's repository root for the rest.

```sh
docker compose -f docker-compose.bench.yml --profile clickhouse up -d clickhouse        # ackee/
docker compose -f docker-compose.spike.yml build
docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/setup-stand.js  # user, workspace, indexes
docker compose -f docker-compose.spike.yml run --rm tools src/rollups/backfill.js         # A, before ackee-a starts
docker compose -f docker-compose.spike.yml run --rm tools scripts/migrate-to-clickhouse.js # B
docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/mv.js setup       # C
docker compose -f docker-compose.spike.yml up -d ackee-a ackee-b
```

The backfill has to finish before `ackee-a` starts: the worker of a server without rollups would start its own backfill five minutes later. Every Ackee of this branch on the stand runs with `ACKEE_AUTO_INDEX=false`, so Mongoose builds no index on `records`, which v1.0 shares; `setup-stand.js` builds the indexes of the collections the branch adds. Spike containers log in with `bench@bench.local` / `bench`.

`tools` runs scripts in the stand's network and in UTC, like the stand's Ackee: day boundaries follow the process time zone. Scripts started on the host need `TZ=UTC` and the stand's ports (`ACKEE_MONGODB=mongodb://127.0.0.1:27018/ackee ACKEE_CLICKHOUSE=http://127.0.0.1:8124 ACKEE_CLICKHOUSE_PASSWORD=bench`).

Once prepared, the stand comes back with `docker compose -f docker-compose.bench.yml --profile clickhouse start clickhouse` (ackee/) and then `docker compose -f docker-compose.spike.yml start`; `ackee-b` needs ClickHouse to start. After `ackee-a` was down, its rollups end where it stopped and A answers from raw records until the first worker pass, on the next five-minute mark: wait for it before measuring.

## Check parity

```sh
docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/parity.js
TZ=UTC ACKEE_MONGODB=mongodb://127.0.0.1:27018/ackee node tools/spike-15/parity-api.js --domain <id>
```

`parity.js` compares raw MongoDB (the v1.0 code path), A, B and C at the data layer from one fixed `--now`. `parity-api.js` sends the same GraphQL request to v1.0, A and B at once, which is the comparison with the code of `develop`; it first checks that the rollups of A cover the window, as `rollups-ready.js` does. Both take `--time-zone` several times (default `UTC` and `Europe/Kiev`) and exit with 1 on a difference. Interval reports must agree entry by entry; `TOP` reports sort by count alone, so rows tied at the cut-off may differ and only the rows above it and the multiset of counts are compared.

## Measure

End to end, through GraphQL (v1.0, A, B): `npm run measure` of `develop` takes the server and the login.

Every measurement of ACKEE-15 is in `Europe/Kiev`. Before each run of A, check that it reads rollups: `rollups-ready.js` exits with 1 when they lag behind the current hour (after a restart of `ackee-a` until the next worker pass) or the seal is older than today.

```sh
TZ=UTC ACKEE_MONGODB=mongodb://127.0.0.1:27018/ackee node tools/spike-15/rollups-ready.js   # before A
npm run measure -- --url http://127.0.0.1:3200 --username bench@bench.local --password bench --time-zone Europe/Kiev --unit ms   # ackee/, A
npm run measure -- --url http://127.0.0.1:3300 --username bench@bench.local --password bench --time-zone Europe/Kiev --unit ms   # ackee/, B
```

Under load, `../bench/run.sh` (the k6 scenarios of 22.09, kept outside the repository next to it; their results are `results/bench-2026-09-22.md`) with a token from `token.js` (the token expires a day after its last use); `report.js` already sends `Europe/Kiev`:

```sh
TOKEN=$(node tools/spike-15/token.js http://127.0.0.1:3200 bench@bench.local bench)
(cd ../bench && SKIP_WRITE=1 ./run.sh a http://host.docker.internal:3200 <domain> "$TOKEN" 30s)
```

`report.js` covers views `UNIQUE` and referrers only. `k6-api.sh` runs one report of the four through GraphQL with the same queries and headers, the summary goes where its first argument says. A run against raw MongoDB ends a minute after start, k6 drops what is still running; MongoDB may keep the dropped aggregations, check `db.currentOp()` before the next run:

```sh
tools/spike-15/k6-api.sh tools/spike-15/results/a/durations.json http://host.docker.internal:3200 <domain> "$TOKEN" durations 30s
```

Direct SQL (B and C), single requests and k6 on the captured queries, from the host like `npm run measure`:

```sh
export TZ=UTC ACKEE_CLICKHOUSE=http://127.0.0.1:8124 ACKEE_CLICKHOUSE_PASSWORD=bench
node tools/spike-15/measure-sql.js --time-zone Europe/Kiev --k6 <plans>
tools/spike-15/k6-sql.sh <plans>/c-views-unique.json <results>/c-views-unique.json 30s
```

`measure-sql.js` captures the SQL the ClickHouse store and `variantC.js` send without running it, so the first timed run is the first the server sees. The `--k6` plans carry the time window of the moment they were written; write them again on another day.

The raw part of A on a live site, which the stand leaves empty (one day of unique views, one hour of the rest): `docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/tail-cost.js`.

Disk and row counts of every variant: `docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/sizes.js`.

## Results

`results/` holds the measurements of 19.10.2026 (18.10 21:34–21:53 UTC) as the tools wrote them, unformatted:

| Path                                | What                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `v1-single.md`, `a-single.md`, …    | `npm run measure` per variant (`aplus` is A+), `sql-single.md` for B and C |
| `v1/`, `a/`, `aplus/`, `b/`, `sql/` | k6 summaries, one per report; `*-k6.log` the runs                          |
| `plans/`                            | the SQL `measure-sql.js --k6` captured                                     |
| `aplus-tail-cost.md`, `sizes.md`    | `tail-cost.js`, `sizes.js`                                                 |
| `stats.tsv`, `peaks.txt`            | `docker stats` every 2–5 s and the peaks per phase                         |
| `query-log-errors.tsv`              | every failed ClickHouse query of the window from `system.query_log`        |
| `bench-2026-09-22.md`               | `../bench/RESULTS.md`: the k6 comparison of 22.09, other machine           |

## Clean up

```sh
docker compose -f docker-compose.spike.yml down
docker compose -f docker-compose.spike.yml run --rm tools tools/spike-15/mv.js drop
```

What the spike left in the stand's MongoDB: collections `rollups`, `rollupstates`, `users`, `workspaces`, `memberships`, `migrations`, and `workspaceId` on the stand's domain. v1.0 ignores all of it. ClickHouse holds database `ackee`; `docker compose -f docker-compose.bench.yml --profile clickhouse down` keeps the volume, `rm -v` of the container and `docker volume rm ackee-bench-clickhouse-data` empty it.
