# Importing from Google Analytics

Ackee can read a CSV exported from Google Analytics 4, so a site that is moving over keeps
its history instead of starting from an empty chart.

## What you lose, before you start

GA4 gives you **aggregates**, not events. A row says "this page had 42 views on this date"
and there is no way back to the 42 individual visits. Ackee stores events, so the importer
expands each row into that many records.

That has one consequence worth knowing before you run it:

- **Unique views over an imported period read low.** An aggregate cannot say who the visits
  belonged to, so imported records carry no visitor hash. Inventing one would make the
  number look real when it is not.
- Everything counted by occurrence is exact: page views, referrers, countries, browsers,
  operating systems, devices.
- Visit durations are absent, because GA4 does not export them per view.

## Exporting

In GA4, open the report you want, then **Share this report → Download file → CSV**.
Reports that work well:

- **Pages and screens** — page views per path
- **Traffic acquisition** — views per source
- **Tech details** — views per browser, operating system or device
- **Demographic details** — views per country

You can import several exports into the same domain one after another. Each adds records;
none replaces what is already there.

## Importing

```sh
npm run import:ga4 -- --domain <domain id> --file pages.csv
```

The site address is taken from the domain title when that is a host name, because GA4
exports carry paths rather than full addresses. Otherwise pass it:

```sh
npm run import:ga4 -- --domain <id> --file pages.csv --origin https://example.com
```

Most exports have **no date column** — "Pages and screens" is one of them. Give the
importer a date for those, and every row lands on that day:

```sh
npm run import:ga4 -- --domain <id> --file pages.csv --date 2026-09-22
```

Try it on a small scale first. `--limit` caps how many records one row expands into, so a
row counting 4 000 views produces 10 instead:

```sh
npm run import:ga4 -- --domain <id> --file pages.csv --date 2026-09-22 --limit 10
```

## What the columns have to be called

The importer matches the header row against the names GA4 uses, in either the interface or
the API spelling. It needs a count and at least one other column; anything it does not
recognise is ignored rather than guessed at.

| Field    | Accepted headers                                    |
| :------- | :-------------------------------------------------- |
| Count    | Views, Screen page views, Sessions, Pageviews       |
| Date     | Date, Day                                           |
| Page     | Page path, Page path and screen class, Landing page |
| Country  | Country                                             |
| Referrer | Session source, Source, Session source / medium     |
| Browser  | Browser                                             |
| System   | Operating system, OS                                |
| Device   | Device category                                     |

Countries arrive as names and are turned into ISO codes, so "Ukraine" is stored as `UA`.
A name the importer does not know is left out rather than approximated.

A source of `(direct)` or `(none)` means there was no referrer, and is stored as none
rather than as a site with that name.

## Syncing automatically

Instead of exporting by hand, connect the property once and Ackee reads it every night.
Open the domain in Ackee and fill in the **Google Analytics** section.

You need two things.

### The property id

In Analytics, **Admin → Property settings**. It is the numeric id shown at the top right,
not the `G-XXXXXXXXXX` measurement id that goes on your website.

### A service account key

Ackee reads your property as a machine, not as you, so there is no browser sign-in to keep
alive and no token to expire.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, or
   open one you already have.
2. Enable the **Google Analytics Data API** for it.
3. Under **IAM & Admin → Service accounts**, create a service account. It needs no roles in
   the Cloud project itself.
4. Open it, go to **Keys → Add key → Create new key → JSON**, and download the file.
5. Back in Analytics, under **Admin → Property access management**, add the service account
   address from that file as a **Viewer**.

Paste the whole downloaded file into Ackee along with the property id.

The key is stored encrypted, which needs `ACKEE_SECRET` to be set — without it Ackee refuses
to store it rather than keeping it readable. It is checked against the property the moment
you connect, so a key that was never granted access fails in front of you instead of quietly
at four in the morning. It is never shown again, and cannot be read back through the API.

A first sync reaches 30 days back. After that each night adds the previous day. If a run
fails, the day it stopped on is repeated rather than skipped, and the reason appears in the
domain settings.

Disconnecting stops the syncing. Records already imported stay where they are.

## How the records are spread

Views from one row are spread evenly across their day rather than piled at midnight, so a
daily chart shows traffic instead of one spike at 00:00.
