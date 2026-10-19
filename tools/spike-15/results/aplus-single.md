start 21:43:27

> ackee@3.6.3 measure
> node scripts/measure-reports.js --url http://127.0.0.1:3200 --username bench@bench.local --password bench --time-zone Europe/Kiev --unit ms --timeout 5

[Ackee] › ℹ  info      Measuring domain 7f759f5d-3478-4eea-841f-516b760bd58a on http://127.0.0.1:3200, 3 runs per report
[Ackee] › ✔  success   views DAILY UNIQUE #1: 51 ms, 3126644 views
[Ackee] › ✔  success   views DAILY UNIQUE #2: 19 ms, 3126644 views
[Ackee] › ✔  success   views DAILY UNIQUE #3: 54 ms, 3126644 views
[Ackee] › ✔  success   views DAILY TOTAL #1: 15 ms, 4582745 views
[Ackee] › ✔  success   views DAILY TOTAL #2: 10 ms, 4582745 views
[Ackee] › ✔  success   views DAILY TOTAL #3: 10 ms, 4582745 views
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #1: 806 ms, 30 referrers
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #2: 519 ms, 30 referrers
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #3: 635 ms, 30 referrers
[Ackee] › ✔  success   durations DAILY #1: 20 ms, 365 s average
[Ackee] › ✔  success   durations DAILY #2: 11 ms, 365 s average
[Ackee] › ✔  success   durations DAILY #3: 10 ms, 365 s average
| Report | Runs | Failed | Median, ms | Min, ms | Max, ms | Result |
| ------ | ---- | ------ | ---------- | ------- | ------- | ------ |
| views DAILY UNIQUE | 3 | 0 | 51 | 19 | 54 | 3126644 views |
| views DAILY TOTAL | 3 | 0 | 10 | 10 | 15 | 4582745 views |
| referrers TOP LAST_30_DAYS | 3 | 0 | 635 | 519 | 806 | 30 referrers |
| durations DAILY | 3 | 0 | 11 | 10 | 20 | 365 s average |
end 21:43:30
