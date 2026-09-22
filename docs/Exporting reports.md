# Exporting reports

Any report you can see, you can download as CSV or JSON.

There is a button under every card that shows one domain, and a route you can call from a
script or a scheduled job.

## From the interface

Open a domain, or any of the Insights sections, and use **Export CSV** or **Export JSON**
under the card. You get exactly what the card shows: same report, same range, same limit.

Cards that add several domains together have no button. A file of those numbers could not
say which domain each row came from, so it would be a worse answer than no file.

## From a script

```
GET /export/:domainId/:report.:format
```

The route wants the same bearer token as the API. A [permanent token](API.md) is the right
kind here, because it does not expire while your job sleeps.

```bash
curl -H "Authorization: Bearer $ACKEE_TOKEN" \
  "https://ackee.example.com/export/$DOMAIN_ID/countries.csv?range=LAST_30_DAYS&limit=50" \
  -o countries.csv
```

### Reports

| Name           | What it holds                                 |
| -------------- | --------------------------------------------- |
| `views`        | Page views per day                            |
| `unique-views` | Visitors per day                              |
| `durations`    | Average visit length per day, in milliseconds |
| `pages`        | Most read pages                               |
| `referrers`    | Where visits came from                        |
| `systems`      | Operating systems                             |
| `devices`      | Devices                                       |
| `browsers`     | Browsers                                      |
| `sizes`        | Browser window sizes                          |
| `languages`    | Languages                                     |
| `countries`    | Countries, with the two-letter code           |

### Formats

`csv` or `json`. Both hold the same rows.

### Arguments

| Name       | Default          | Notes                                                                                                                                                         |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `range`    | `LAST_30_DAYS`   | `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS` or `LAST_6_MONTHS`. Ignored by `views`, `unique-views` and `durations`, which use `limit` as a number of days. |
| `limit`    | `100`            | At most `1000`.                                                                                                                                               |
| `timeZone` | Server time zone | Also read from a `Time-Zone` header. Decides where a day starts.                                                                                              |

### Answers

| Status | Meaning                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| `200`  | The file, with a `Content-Disposition` naming it after the domain and report |
| `401`  | No token, or a token that has expired                                        |
| `404`  | Unknown report, unknown format, or a domain outside your workspaces          |

## Notes on the file

- **The CSV starts with a byte order mark.** Without it, Excel and Numbers read the file as
  the local encoding and turn every non-Latin label into rubbish.
- **Identifiers are left out.** They are recursive hashes that mean nothing outside a
  running instance.
- **Empty columns are left out.** Several reports carry a `created` field that only the
  "recent" sorting fills in.
- **A field holding a comma, a quote or a line break is quoted**, and a quote inside it is
  doubled, as the CSV convention has it.
