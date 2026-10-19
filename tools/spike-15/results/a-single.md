start 21:39:04

> ackee@3.6.3 measure
> node scripts/measure-reports.js --url http://127.0.0.1:3200 --username bench@bench.local --password bench --time-zone Europe/Kiev --unit ms --timeout 5

[Ackee] › ℹ  info      Measuring domain 7f759f5d-3478-4eea-841f-516b760bd58a on http://127.0.0.1:3200, 3 runs per report
[Ackee] › ✔  success   views DAILY UNIQUE #1: 11372 ms, 3126644 views
[Ackee] › ✔  success   views DAILY UNIQUE #2: 10761 ms, 3126644 views
[Ackee] › ✔  success   views DAILY UNIQUE #3: 10344 ms, 3126644 views
[Ackee] › ✔  success   views DAILY TOTAL #1: 43 ms, 4582745 views
[Ackee] › ✔  success   views DAILY TOTAL #2: 13 ms, 4582745 views
[Ackee] › ✔  success   views DAILY TOTAL #3: 11 ms, 4582745 views
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #1: 647 ms, 30 referrers
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #2: 483 ms, 30 referrers
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #3: 434 ms, 30 referrers
[Ackee] › ✔  success   durations DAILY #1: 14661 ms, 365 s average
[Ackee] › ✔  success   durations DAILY #2: 15681 ms, 365 s average
[Ackee] › ✔  success   durations DAILY #3: 15856 ms, 365 s average
| Report | Runs | Failed | Median, ms | Min, ms | Max, ms | Result |
| ------ | ---- | ------ | ---------- | ------- | ------- | ------ |
| views DAILY UNIQUE | 3 | 0 | 10761 | 10344 | 11372 | 3126644 views |
| views DAILY TOTAL | 3 | 0 | 13 | 11 | 43 | 4582745 views |
| referrers TOP LAST_30_DAYS | 3 | 0 | 483 | 434 | 647 | 30 referrers |
| durations DAILY | 3 | 0 | 15681 | 14661 | 15856 | 365 s average |
end 21:40:24
