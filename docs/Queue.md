# Queue

With `ACKEE_INGEST_QUEUE=redis` (see [Options](Options.md#ingest-queue)) the API no longer writes events itself. Each tracker mutation is validated, appended to a Redis Stream and answered; a worker process reads the stream in batches and makes the same writes the API would have made. The event store (`mongo`, `dual`, `clickhouse`) is unchanged, the queue only sits in front of it.

## Running

1. Start Redis 7.0 or newer (for development: `docker compose -f docker-compose.dev.yml up -d`). Older versions lack the `lag` field of `XINFO GROUPS` that the backlog metric reads. Events that reached Redis but not yet the worker live only in Redis: turn on persistence (`appendonly yes`, or RDB snapshots at an interval you can afford to lose) so that a Redis restart does not drop them. The development compose file uses the image defaults, which is RDB snapshots on a volume.
2. Start Ackee and the worker with the same environment:

   ```
   ACKEE_INGEST_QUEUE=redis ACKEE_REDIS_URL=redis://localhost:6379 npm run server
   ACKEE_INGEST_QUEUE=redis ACKEE_REDIS_URL=redis://localhost:6379 npm run worker
   ```

   Both refuse to start when Redis is unreachable. The worker also refuses to start with `ACKEE_INGEST_QUEUE=none`, there would be nothing to read. `docker-compose.dev.yml` has the worker as a service behind the `worker` profile (`docker compose -f docker-compose.dev.yml --profile worker up -d worker`), built from the working tree and pointed at MongoDB on the host.

3. Watch the backlog: `ackee_queue_length` on `/metrics` (with `ACKEE_METRICS=true`) is the number of messages the worker has not acknowledged yet, `0` when it has caught up. The worker logs its counters every 10 batches and once more on shutdown.

Stopping the worker with `SIGTERM` or `SIGINT` finishes the current batch, acknowledges it, flushes the ClickHouse buffer and exits. Events that arrive meanwhile wait in Redis and are written when a worker is back.

To go back to synchronous writes, stop the API, let the worker drain the stream (`ackee_queue_length` is `0`, or `XINFO GROUPS ackee:events` shows `lag` and `pending` at `0`), then restart the API with `ACKEE_INGEST_QUEUE=none`. Acknowledged entries stay in the stream up to the trim limit, `XLEN` is not the backlog.

## What the worker does

The stream `ackee:events` (`ACKEE_REDIS_STREAM`) holds messages of four types. The API generates the record or action `id` and its `created`/`updated` dates when it validates the input and puts them in the message, so the tracker's answer and the stored row agree even when the worker writes minutes later.

| Type            | API                                                                 | Worker                                                          |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `record.create` | validates, answers `{ id, ... }` from the validated, unsaved record | `store.addRecord(payload)` then `store.anonymize(clientId, id)` |
| `record.touch`  | answers `success` at once                                           | `store.touchRecord(id, updated)`                                |
| `action.create` | validates, answers `{ id, ... }`                                    | `store.addAction(payload)`                                      |
| `action.touch`  | answers `success` at once                                           | `store.touchAction(id, { key, value, details, updated })`       |

Messages are read through the consumer group `ackee-workers` (`XREADGROUP`, up to 1000 per batch, blocking for a second when the stream is empty), processed one by one in stream order and acknowledged (`XACK`) as a batch once MongoDB has every write and the ClickHouse buffer has been flushed. Before each batch the worker claims (`XAUTOCLAIM`) messages that were read but not acknowledged within a minute, whichever consumer read them, its own earlier incarnation included, which is what a crashed worker leaves behind, so they are replayed first. The stream is trimmed to roughly one million entries (`MAXLEN ~ 1000000`), which is the number of events a stopped worker can miss before the oldest are lost, and acknowledged entries are trimmed after a day, see [Privacy](#privacy).

## Delivery guarantees

- **At least once.** A message is acknowledged only after its writes succeeded and were flushed; a crash before that redelivers it. Nothing is lost while Redis keeps the stream and the worker's absence stays under the trim limit.
- **Duplicates cannot create duplicate rows.** The `id` travels in the message and is unique in MongoDB, so a redelivered `record.create` or `action.create` fails with `E11000`. The worker then pushes the document as MongoDB holds it now to ClickHouse as one more version (`mirrorRecord`/`mirrorAction` of the store): the first delivery may have died after its MongoDB write and before its buffered ClickHouse rows were flushed, and this closes that hole. In ClickHouse every write is a version of the same `id` and `ReplacingMergeTree` keeps one row per `id` under `FINAL`. A redelivered `record.create` repeats the anonymization of the visitor's earlier records, because the first delivery may have died between the MongoDB write and that step; when it did not, the earlier records have no `clientId` any more and nothing matches. The one case where the repeat does something is a redelivery replayed behind a newer record of the same visitor (the worker was restarted within the idle minute, so the newer message went first): the newer record is anonymized too, as it would be by two overlapping `createRecord` calls without the queue.
- **Touches are idempotent and never shorten a visit.** `updated` is the time the API answered, not the time the worker writes, and MongoDB keeps the larger of the stored and the delivered value (`$max`), so a redelivered touch sets the same value and a touch replayed behind a later one changes nothing.
- **Only known-broken messages are dropped.** A message whose payload is not JSON, is not an object, fails the schema validation (`ValidationError`, `CastError`) or has an unknown type can never succeed and is dropped on its first delivery, logged with an error and acknowledged, so it cannot block the stream. A touch for an id that does not exist can be a touch redelivered ahead of its create, so it is retried: left unacknowledged, logged with a warning, claimed again after the idle minute and given up with an error after the fifth failed delivery. Every other error is taken for a store outage (MongoDB not connected, server selection timed out, or something unforeseen): the batch stops at that message, what was written before it is acknowledged and the ClickHouse buffer flushed, the failed message and those behind it stay unacknowledged, and the worker retries after five seconds, oldest first, for as long as it takes. An unforeseen error therefore stalls the stream with an error in the log every five seconds instead of dropping events.
- **Order is per worker.** One worker processes the stream in order, so the writes of one visitor (create, touch, the anonymization of the earlier record) land in the order the tracker sent them, which closes the touch/anonymize race described in [`SEMANTICS.md`](../src/stores/clickhouse/SEMANTICS.md). Several workers share the stream and interleave; the race is then back to what it is without the queue, and redelivery after a crash also replays behind newer messages. Retries of a touch for an unknown id are then also claimed by whichever worker comes first, so one message can be tried by several workers within its five deliveries, which is safe but wasted work.
- **What the tracker no longer learns.** Without the queue `updateRecord` for an unknown `id` and an oversized `updateAction` are answered with an error; with the queue both are accepted and fail in the worker's log. `createRecord` and `createAction` are still validated before they are queued and answer the same errors as before. When Redis is down the tracker gets an error and the event is lost, as it is when MongoDB is down without the queue.
- **ClickHouse outage.** The flush before the acknowledgement inserts the batch; when ClickHouse is unreachable the rows stay in the worker's buffer and are retried as in `dual` mode, and the batch is acknowledged anyway, MongoDB has it. A worker that crashes during a ClickHouse outage loses that buffer and nothing redelivers it; the backfill from MongoDB (`scripts/migrate-to-clickhouse.js`) restores it, see [ClickHouse](ClickHouse.md#rollback).

## Privacy

Redis keeps acknowledged entries until they are trimmed, and each entry holds the event as the tracker sent it: the `clientId` (a daily-salted hash of IP, user agent and domain) with the device, browser and screen fields that MongoDB and ClickHouse null out once the visitor's next event arrives. The stream is therefore a copy of the visit data that the anonymization does not reach. To bound it the worker trims entries older than 24 hours (`XTRIM MINID`, entry ids start with the milliseconds of `XADD`) after every batch and every empty read, so the stream holds at most a day of un-anonymized events while a worker is running. Nothing unacknowledged is ever trimmed: the floor is the oldest pending entry, or the entry after the last one delivered, so a backlog older than a day that the worker is still catching up on survives until it is written. With no worker running nothing trims and the `MAXLEN` limit is the only bound: at about 0.7 KB per entry (measured with a full `record.create` payload) the stream reaches roughly 0.7 GB of Redis memory at one million events, all of it visit data.

Redis persistence is the operator's side of this: RDB snapshots and the AOF hold everything that was in the stream when they were written, trimming the stream does not rewrite them, and they are not covered by the data retention Ackee promises. Keep them on encrypted storage with a retention of their own, or run Redis without persistence and accept that a Redis restart loses the events the worker had not written yet.

## Metrics

| Metric                        | Type    | Meaning                                                                                                                                                    |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ackee_queue_length`          | gauge   | Backlog: undelivered plus unacknowledged messages (`XINFO GROUPS` lag and pending), read from Redis on every scrape of the API; the worker logs it instead |
| `ackee_queue_processed_total` | counter | Messages the worker wrote and acknowledged (a redelivered duplicate counts too)                                                                            |
| `ackee_queue_failed_total`    | counter | Deliveries that failed, one per attempt                                                                                                                    |
| `ackee_queue_dropped_total`   | counter | Messages given up on after five failed deliveries                                                                                                          |

The three counters are process-local: on the API they stay at zero, the worker prints them in its log. `ackee_records_created_total` and `ackee_actions_created_total` count on the API what was queued, not what was written. All four series are exported whatever `ACKEE_INGEST_QUEUE` is; with `none` they are present and stay at `0`.
