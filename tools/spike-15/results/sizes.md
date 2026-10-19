| MongoDB collection | Documents | Data, MiB | On disk, MiB | Indexes, MiB |
| ------------------ | --------- | --------- | ------------ | ------------ |
| records | 10000000 | 4808.2 | 1764.0 | 2416.8 |
| rollups | 1599909 | 395.1 | 95.1 | 120.7 |
| rollupstates | 1 | 0.0 | 0.0 | 0.0 |

| Rollup dimension | Documents |
| ---------------- | --------- |
| __durations | 1441 |
| __uniqueViews | 1441 |
| __views | 1441 |
| browserHeight | 11528 |
| browserName | 7205 |
| browserName|browserVersion | 10087 |
| browserWidth | 11528 |
| browserWidth|browserHeight | 11528 |
| deviceManufacturer | 4323 |
| deviceManufacturer|deviceName | 7205 |
| osName | 7205 |
| osName|osVersion | 7205 |
| screenHeight | 11528 |
| screenWidth | 11528 |
| screenWidth|screenHeight | 11528 |
| siteLanguage | 11528 |
| siteLocation | 432192 |
| siteReferrer | 216111 |
| source | 4323 |
| source|siteReferrer:or | 819034 |

| ClickHouse table | Active parts | Rows | On disk, MiB | Compressed, MiB | Uncompressed, MiB |
| ---------------- | ------------ | ---- | ------------ | --------------- | ----------------- |
| records | 18 | 10000000 | 1163.9 | 1163.7 | 2140.7 |
| referrers_hourly | 1 | 819034 | 2.0 | 2.0 | 60.2 |
| views_hourly | 1 | 1441 | 0.0 | 0.0 | 0.1 |
