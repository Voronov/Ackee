# Google Analytics

Ackee can read a Google Analytics 4 property next to its own numbers: every report can show Ackee, Google Analytics, or both side by side. Useful while moving over, to keep the history, and to see where the two disagree.

## What it needs

- `ACKEE_SECRET_KEY` on the server, any long random string. Ackee keeps the Google key in the database encrypted with it. Without it the connection is refused. Changing it makes stored keys unreadable: connect the domains again.
- A service account in Google Cloud with read access to the property. It needs no other rights.

## Connect a domain

Settings → Domains → the domain → **Google Analytics →**. The dialog lists the same steps:

1. In Google Cloud, pick or create a project and enable the **Google Analytics Data API**.
2. Under IAM → Service accounts, create a service account. It needs no role in the project.
3. Open it, then Keys → Add key → Create new key → JSON. The browser downloads a file.
4. In Google Analytics, open Admin → Property access management → + → Add users, and add the service account's address (`client_email` in the file) as a **Viewer**.
5. Copy the property id from Admin → Property details. It is a number, like 123456789.
6. Paste the id and the whole JSON file into the dialog and connect.

Ackee reads a week of views once before it stores anything, so a wrong id or a missing permission shows at once, in Google's words.

## Sync

- The first sync reads about 14 months of history. That takes a few minutes; the dialog shows how far it got.
- Then every three hours, or as `ACKEE_GA4_SYNC_SCHEDULE` says. Each run reads the last three days again, because Google Analytics finishes counting a day up to three days later. Reading the same days twice changes nothing.
- **Sync now** in the dialog runs it at once. **Disconnect** forgets the property and deletes every day synced from it.

## What is shown

The data stays apart from Ackee's own records: Google Analytics counts with cookies and Ackee without, so mixing them would make both wrong. The source switch above the reports appears once a domain is connected.

| Ackee report               | Google Analytics 4                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Views, total               | `screenPageViews` per day                                                                 |
| Views, unique              | `activeUsers` per day; days add up, so someone who came back on two days counts twice     |
| Durations                  | `averageSessionDuration`, weighted by sessions                                            |
| Pages                      | `fullPageUrl`                                                                             |
| Referrers                  | `sessionSource`                                                                           |
| Systems, devices, browsers | `operatingSystem` (with version), `mobileDeviceBranding` / `mobileDeviceModel`, `browser` |
| Sizes, languages           | `screenResolution`, `language`                                                            |

- Google Analytics reports days, not visits: lists sorted by New or Recent, and active visitors, stay empty for it.
- Days are the property's days, in its time zone.
- Nothing that identifies a person is read or stored: only these dimensions and counts.
