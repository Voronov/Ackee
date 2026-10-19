start 21:46:05

> ackee@3.6.3 measure
> node scripts/measure-reports.js --url http://127.0.0.1:3300 --username bench@bench.local --password bench --time-zone Europe/Kiev --unit ms --timeout 5

[Ackee] › ℹ  info      Measuring domain 7f759f5d-3478-4eea-841f-516b760bd58a on http://127.0.0.1:3300, 3 runs per report
[Ackee] › ✔  success   views DAILY UNIQUE #1: 271 ms, 3126644 views
[Ackee] › ✔  success   views DAILY UNIQUE #2: 132 ms, 3126644 views
[Ackee] › ✔  success   views DAILY UNIQUE #3: 140 ms, 3126644 views
[Ackee] › ✔  success   views DAILY TOTAL #1: 51 ms, 4582745 views
[Ackee] › ✔  success   views DAILY TOTAL #2: 51 ms, 4582745 views
[Ackee] › ✔  success   views DAILY TOTAL #3: 51 ms, 4582745 views
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #1: 142 ms, 30 referrers
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #2: 115 ms, 30 referrers
[Ackee] › ✔  success   referrers TOP LAST_30_DAYS #3: 102 ms, 30 referrers
[Ackee] › ✔  success   durations DAILY #1: 80 ms, 365 s average
[Ackee] › ✔  success   durations DAILY #2: 65 ms, 365 s average
[Ackee] › ✔  success   durations DAILY #3: 68 ms, 365 s average
| Report | Runs | Failed | Median, ms | Min, ms | Max, ms | Result |
| ------ | ---- | ------ | ---------- | ------- | ------- | ------ |
| views DAILY UNIQUE | 3 | 0 | 140 | 132 | 271 | 3126644 views |
| views DAILY TOTAL | 3 | 0 | 51 | 51 | 51 | 4582745 views |
| referrers TOP LAST_30_DAYS | 3 | 0 | 115 | 102 | 142 | 30 referrers |
| durations DAILY | 3 | 0 | 68 | 65 | 80 | 365 s average |
end 21:46:07
