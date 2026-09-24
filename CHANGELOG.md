# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ACKEE_EVENT_STORE` selects which store answers reports and takes writes: `mongo` (the default, unchanged behaviour), `dual` (both written, MongoDB answers) or `clickhouse`. The choice is made once, above the reports, instead of inside each of them
- Unique views and active visitors are answered from ClickHouse. The columnar schema now keeps the visitor hash and versions rows, so anonymization is mirrored as a new version instead of rewriting history — which is what previously kept those two reports on MongoDB
- An `actions` table, so event reports have a columnar path as well
- `ACKEE_INGEST_QUEUE=redis` puts an accepted event on a Redis stream and lets `npm run worker:ingest` store it, so a slow store cannot slow the tracker down. The record is validated while the tracker is still waiting, and delivery is at-least-once
- `npm run clickhouse:migrate` copies existing history with a checkpoint, so an interrupted run resumes. It replaces `npm run clickhouse:backfill`

### Changed

- `ACKEE_CLICKHOUSE_READS` is replaced by `ACKEE_EVENT_STORE`: a boolean could express two of the three states
- Reports no longer fall back from ClickHouse to MongoDB. With `clickhouse` selected the columnar store answers alone, so history has to be migrated before switching. Rollups are untouched and keep serving the `mongo` and `dual` stores
- Writes to ClickHouse are buffered and flushed in batches instead of inserted one row at a time inside the request
- The action report orders by the earliest `created` per key rather than whichever document the storage engine returned first, matching the fix already made for records. The compound index `{ eventId, created }` added here is what made the previous order wrong

## [4.0.2] - 2026-09-22

### Changed

- The header is one row: the logo and the sections on the left, the person on the right. Settings moved out of the navigation and into a menu under an avatar, because settings belong to whoever is signed in rather than to the list of reports. The avatar shows two letters taken from the email address, and the menu holds the address, Settings and Sign out. Signing out now also removes the token on the server, so a session left open elsewhere stops working too

## [4.0.1] - 2026-09-22

A major version, because several changes break an existing installation: the single account
configured through the environment is gone, domains now belong to a workspace, and events to
a user. This release is **install-from-scratch only** — upgrading a 3.x installation is not
supported, because the versioned migration mechanism is deliberately out of scope.

### Added

- Importing a CSV exported from Google Analytics 4, so a site that moves over keeps its history. GA4 gives aggregates rather than events, so each row is expanded into the views it counts and spread across its day; imported records carry no visitor hash, which the guide says plainly because unique views over an imported period read low as a result
- A guide for installing through Google Tag Manager, and the same snippet offered in the domain dialog. Nothing about the tracker changes: Tag Manager just owns the markup instead of you
- An ingest key per domain, carried by the embed code after the domain id. Checking is off per domain until the owner turns it on, and with it on an event also has to come from the site the domain is named after. The key is visible on the page, so it raises the bar rather than closing the door, and it can be rotated
- Accounts, workspaces and roles. Anyone can register and gets a personal workspace to put their own domains in; nobody administers anyone else. `ACKEE_ALLOW_SIGNUP=false` closes registration on instances that exist to measure their owner's own sites

- Compound index `{ domainId, created }` on records. Every report matches on both fields, so the previous single-field indexes made the planner read the whole domain history or the whole collection
- Hourly rollups for all top reports and for total views, behind `ACKEE_ROLLUPS`. Whole hours are read from pre-computed buckets, the two partial edges of the window from raw records, so results stay exact rather than approximate
- `npm run rollup:backfill` to build rollups for existing history. Reports fall back to raw records automatically while a time window is not yet covered
- ClickHouse as a columnar event store, behind `ACKEE_CLICKHOUSE`. Events are dual-written to both stores and reports are answered by the fastest one that covers the requested window — ClickHouse, then hourly rollups, then raw records. `npm run clickhouse:backfill` copies existing history. Unique views stay on MongoDB, and the visitor hash is never copied to the columnar store
- Country of a visit, behind `ACKEE_GEO`, with a `countries` report. Resolved from the IP at ingest against a database shipped with the installation, so nothing is sent to a third party; the IP itself is still never stored. Off by default, and city-level resolution is deliberately not offered
- Prometheus metrics at `/metrics`, behind `ACKEE_METRICS_TOKEN`: HTTP, GraphQL and MongoDB command durations, plus rollup build duration and worker lag
- Test coverage thresholds, dependency audit, Docker image build and CodeQL scanning in CI
- Downloading any report as a CSV or JSON file, with a button under every card that shows one domain and a `GET /export/:domainId/:report.:format` route for a script. The CSV starts with a byte order mark, without which Excel reads a non-Latin label as rubbish. Cards that add several domains together have no button, because a file of those numbers could not say which domain each row came from
- A live feed of visits on every domain page, pushed over server-sent events as each visit is written. Version 3.x had one number, `activeVisitors`, polled every five minutes. The visits are found by polling `{ domainId, created }`, since ingest is a separate process and the alternatives need either a replica set or a queue; one poll serves every listener on a domain
- An MCP server, so an assistant can answer questions about a site by reading its reports. Six tools over the existing API, started over stdio. It only reads, and it sees exactly what the token it was given sees

### Changed

- `ACKEE_USERNAME` and `ACKEE_PASSWORD` are gone. The single hard-coded account they described could not be extended into real users: the request context carried "is this authenticated" rather than "who is this", so no domain could have an owner. Passwords are now stored as scrypt hashes and tokens belong to a user

- The single-field `domainId` index is gone. It is a prefix of the new compound index, so it served the same queries while costing writes and storage

### Fixed

- Top reports (`pages`, `referrers`, `systems`, `devices`, `browsers`, `sizes`, `languages`) returned a non-deterministic result: `$sort` ran on `count` alone with `$limit` after it, so both the order and — at the cut-off — the membership of the top-N varied between identical requests on unchanged data. Sorting now falls back to the dimension's own fields

## [3.6.1] - 2026-09-18

### Changed

- Action values can now be omitted or set to `null` when creating actions, matching the existing support for resetting values on update
- HTTP responses now include security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.) via `helmet`
- The `Time-Zone` request header is now validated before use; invalid values fall back to the server timezone silently
- Free-text fields in the database (`source`, `deviceName`, `deviceManufacturer`, `osName`, `osVersion`, `browserName`, `browserVersion`, `title`, `key`, `details`) now enforce maximum length limits to prevent storage abuse

## [3.6.0] - 2026-04-08

Code refactoring, internal improvements and dependency updates to bring the codebase up to date with the latest versions and features of Node.js and MongoDB (fixes #377).

### Changed

- Ackee now requires Node.js 24 or newer

### Fixed

- Vercel deployments and serverless functions (#401, #385)

## [3.5.1] - 2025-11-19

### Changed

- Several dependencies have been updated to their latest versions to bring in security patches and improvements

### Fixed

- `ackee-tracker` has been updated to fix an issue where visits were not recorded when the website had an empty `document.referrer`. You might have seen lower visit counts since version 3.5.0 when your website had no referrer, e.g., when visiting it directly or via bookmarks.

## [3.5.0] - 2025-11-13

Small fixes, internal improvements and dependency updates.

### Changed

- Ackee now requires Node.js 22 or newer (fixes #343)
- The official Docker image is now based on Node.js 22 (fixes #343)
- Netlify builds use Node.js 22 (fixes #343)
- URLs without protocols (e.g., `example.com`) are now rejected by the API. The official `ackee-tracker` client sends `window.location.href` with protocol, so this only affects custom API clients sending malformed URLs as `siteReferrer` and `siteLocation`.

### Fixed

- ReDOS vulnerability of is_js, the request-ip dependency (thanks @marek629, #392)

## [3.4.2] - 2022-12-17

### Changed

- Adjust Docker to run as non-root user (thanks @rjhancock, #309, #337)

## Fixed

- Rendering issue in Safari

## [3.4.1] - 2022-05-21

### Fixed

- Build failing on Netlify (thanks @adityatelange, #333)
- Vercel not attaching CORS headers because of unsupported `multiValueHeaders` (thanks @birjj, #330)
- `ACKEE_AUTO_ORIGIN` not attaching CORS headers (thanks @birjj, #330)

## [3.4.0] - 2022-05-15

### Added

- Support for Node.js 17 (#302)
- Cache preflight requests (via `Access-Control-Max-Age`) (#261)
- Automatically add CORS headers for domains that have fully qualified domain names as titles ([`ACKEE_AUTO_ORIGIN`](docs/Options.md)) (#271)

### Changed

- MongoDB 4.4 or newer is now required, but older versions still may work

## [3.3.1] - 2022-01-16

You will see a lower unique visitor count after updating. This release contains a fix for the unique visitor count and anonymisation that was broken since 3.2.0. The recorded visits were still anonymous, but Ackee tracked the visit path of each visitor. Data that Ackee normally removes. Data tracked since 3.2.0 are all counted as unique, even if they were not.

### Fixed

- Unique visitor count and anonymisation (#304)

## [3.3.0] - 2021-12-04

### Added

- Docker support for linux/arm64 and linux/arm/v7 (#298)

## [3.2.0] - 2021-09-18

### Changed

- Switch to official Node.js Docker image
- Updated dependencies, including mongoose (thanks @suda, #291)

## [3.1.1] - 2021-06-27

### Fixed

- "Float cannot represent non numeric value: NaN" when visiting a new installation of Ackee

## [3.1.0] - 2021-06-27

> ⚠️ Contains breaking changes in the GraphQL API

This release contains a refactored front-end that takes advantage of the GraphQL API that has been a part of Ackee since version 2. Better caching and instant domain, event and permanent token updates. And: An active visitor counter that updated periodically without reloading the UI.

### Added

- Views and duration details: Click on a chart bar on the overview and insights page to see more details
- Percentage changes of average views and duration in the facts panel
- Active visitors counter updates periodically without reloading the UI
- Tooltips for text in lists (#266)

### Changed

- `DomainStatistics` and `EventStatistics` (GraphQL API) now contain a unique id field
- `View`, `Duration` and `EventChartEntry` (GraphQL API) now contain their date in a `value` field in the format: YYYY, YYYY-MM or YYYY-MM-DD. The format depends on the chosen interval.
- `DomainStatistics` and `EventStatistics` (GraphQL API) now contain a unique id in the `id` field. The previous data has been renamed to `value`, because it was never unique and therefore shouldn't be named `id`.
- `averageViews` and `averageDuration` (GraphQL API) are now types and don't contain the values directly

## [3.0.6] - 2021-04-02

### Changed

- Updated dependencies, including `ackee-tracker` in v5.1.0 which ignores updateRecord request when the website is in the background (#202)

## [3.0.5] - 2021-02-21

### Changed

- Ackee now requires Node.js 14 in the `package.json` even when Node.js 14 was already required
- Tests are testing with Node.js 14 and 15

## [3.0.4] - 2021-02-21

### Fixed

- Unable to set Access-Control-Allow-Credentials Header on Platforms-As-A-Service Deployments (#223)

## [3.0.3] - 2021-01-24

### Added

- Missing breaking change notice in the changelog of version 3.0.0 for those using a wildcard `Access-Control-Allow-Origin` header

### Fixed

- Unknown sizes id when a size is zero (#217)
- Prevent unknown id errors like in #217 for other record properties
- Updated ackee-tracker which re-added `ignoreOwnVisits` for those using a wildcard `Access-Control-Allow-Origin` header

## [3.0.2] - 2021-01-21

### Fixed

- Temporary workaround for missing browser sizes (#217)

## [3.0.1] - 2021-01-21

### Fixed

- UI showing the wrong version
- Server serving an outdated version of ackee-tracker

## [3.0.0] - 2021-01-21

Events, browser navigation and better referrers 🎉

### Highlights

#### Events

Ackee can now [track events](docs/Events.md) like newsletter subscriptions, buttons clicks, checkout sums and more. It's the most requested feature and I'm happy that it's finally a part of Ackee.

#### Browser navigation

You can now use the back and forward buttons to navigate between pages.

#### Referrers 2.0

You can now [specify a `source` parameter in URLs](docs/Enhancing%20referrers.md) (e.g. `https://example.com?source=Newsletter`). Ackee will use the parameter instead of the referrer when available. This allows you the track links from newsletters and other platforms more precisely.

#### Faster startup, smaller size

Ackee previously had to compile all source files before the server was ready. v3 now ships with all files Ackee needs and only builds those containing environment variables. This means running `yarn start` is way faster and the Docker container even smaller.

Oh, and we also reduced the JS file size of the UI by ~60%.

### Breaking changes

#### `Access-Control-Allow-Origin: "*"` not recommended

> This change is relevant for you when using a wildcard as the Access-Control-Allow-Origin.

Using a wildcard (`*`) for the `Access-Control-Allow-Origin` header was never recommended as it's neither a secure solution nor does it allow Ackee to ignore your own visits. Please disable the `ignoreOwnVisits` option in ackee-tracker if you're currently using a wildcard. The [SSL and HTTPS](docs/SSL%20and%20HTTPS.md) guide contains better alternatives.

`ignoreOwnVisits` is now enabled by default and won't work when using a wildcard.

#### New `Access-Control-Allow-Credentials` header

> This change is relevant for everyone.

Ackee requires [a new `Access-Control-Allow-Credentials` header](docs/CORS%20headers.md#credentials) which was previously optional. Make sure to add this header in your server or reverse proxy configuration.

#### ackee-tracker with new `.create` and `.record` syntax

> This change is only relevant for you when using ackee-tracker in the [Manually](https://github.com/electerious/ackee-tracker/blob/master/README.md#manually) or [Programmatic](https://github.com/electerious/ackee-tracker/blob/master/README.md#programmatic) way.

The [changelog of ackee-tracker](https://github.com/electerious/ackee-tracker/blob/master/CHANGELOG.md) contains everything you need to know when updating to the newest version.

#### Referrers require `ReferrerType` in GraphQL API

> This change is relevant for you when using the GraphQL API.

A new parameter is required when requesting referrers via the GraphQL API. The parameter is called `ReferrerType` and can be `WITH_SOURCE`, `NO_SOURCE` or `ONLY_SOURCE`.

#### Referrers can return non URL ids via GraphQL API

> This change is relevant for you when using the GraphQL API.

The `id` of requested referrers was always a URL, but has been changed to a string. That's because [referrers can now include parameters](docs/Enhancing%20referrers.md) (e.g. `source` when using `ackee-tracker`).

### Added

- Browser navigation. It's now possible to navigate using the back and forward button in the browser.
- "Copied to clipboard" message when clicking on an input or textarea that copies to the clipboard (#166)
- Modals can be closed with the ESC key
- Tests for permanent tokens, events and actions
- `source` field for records to track (thanks @BetaHuhn, #185)
- Referrers will now show the `source` parameter when available (thanks @BetaHuhn, #185)
- Use the `s` key to open the settings and `o` to switch to the overview ([Keyboard shortcuts](docs/Keyboard%20shortcuts.md))
- Explanation why data is missing (#192)

### Changed

- `Access-Control-Allow-Origin: "*"` not recommended
- New `Access-Control-Allow-Credentials` header required
- ackee-tracker with new `.create` and `.record` syntax
- Referrers require `ReferrerType` in GraphQL API
- Referrers can return non URL ids via GraphQL API
- Compiled source files are now part of the repo
- Docker container size has been reduced (again)
- Updated build tools allow us to use ~60% less JS in the UI

### Fixed

- Close, delete and submit in modals could be triggered multiple times

## [2.4.1] - 2020-12-20

### Changed

- Updated Dockerfile reduces the size of the Docker build by ~58% (#195, thanks @omBratteng)

### Fixed

- Errors from permanent tokens not showing up in the UI
- Remove console logs from `apollo-server-plugin-http-headers`
- Log GraphQL error instead of `undefined`

## [2.4.0] - 2020-11-15

Ackee now ignores your own visits once you have logged into the dashboard. Make sure to enable the [`ignoreOwnVisits` option in ackee-tracker](https://github.com/electerious/ackee-tracker#-options) to use this feature. It's currently opt-in, because it requires [a new `Access-Control-Allow-Credentials` header](docs/CORS%20headers.md#credentials), which wasn't previously required. It will be turned on by default in the next major release of Ackee.

> ℹ️ Some browsers strictly block third-party cookies when Ackee runs on a different domain than the site you're visiting. Therefore, it may happen that your own visits still find their way into your statistics, even when the option `ignoreOwnVisits` is turned on.

### Added

- Ignore own visits (#100, thanks @yehudab)
- Tons of new tests (#171, thanks @yehudab)

## [2.3.0] - 2020-11-04

This release adds [support for Vercel](docs/Get%20started.md) and updates the included `ackee-tracker` which now ignores bots.

### Added

- Support for Vercel (#180, thanks @elliottsj)
- Contributing guide and issue templates (#184, thanks @BetaHuhn)

### Changed

- ackee-tracker updated to version 4.1.0

## [2.2.0] - 2020-11-01

New tools like [ackee-report](https://github.com/BetaHuhn/ackee-report), [ackee-bitbar](https://github.com/electerious/ackee-bitbar) and the [Ackee iOS widget](https://twitter.com/getackee/status/1320996848623099909) are build upon the powerful API of Ackee. This release makes it even easier to them by introducing permanent tokens. Permanent tokens never expire and are perfect for tools that run in the background. You can create them in the settings of Ackee and use them for authentication in Ackee-powered apps.

### Added

- Permanent tokens (#176, thanks @BetaHuhn)

### Fixed

- Serverless function CORS headers (#175)

## [2.1.1] - 2020-10-28

### Fixed

- Error while deploying to Netlify (#175)

## [2.1.0] - 2020-10-24

This release introduces support for serverless functions. You can now deploy Ackee to Netlify 🚀 It also reduces the memory usage and allows you to build all static files into `/dist` by running `yarn build`. Run `yarn server` to start the server without building those files, again. This reduces the initial startup time. `yarn start` combines both commands for convenience and is still the recommended way to run Ackee.

### Added

- Support for serverless functions and Netlify (#155)
- Added "Deploy to Netlify" to the [Get Started](docs/Get%20started.md) guide
- Build all static files into `/dist` by running `yarn build`
- Start the server without rebuilding static files using `yarn server`

### Changed

- Improved scrollbars on Windows (#153, thanks @Go-Merk)

### Fixed

- Reduce high memory usage by building files in a different step (#170)
- Show only active records in visitor counter (#161)
- Labels in modals sometimes not clickable because of invalid ids

## [2.0.3] - 2020-09-20

### Fixed

- Invalid value error (#165)

## [2.0.2] - 2020-09-20

### Added

- [vuepress-plugin-ackee](https://github.com/spekulatius/vuepress-plugin-ackee)
- [gridsome-plugin-ackee](https://github.com/DenzoNL/gridsome-plugin-ackee)

### Changed

- More relevant data on the dashboard: Ackee now shows the top data of the last 24 hours instead of last 7 days
- Heroku installation docs (#154, thanks @Go-Merk and @aleccool213)

## [2.0.1] - 2020-08-16

This updates improves the look of the README and adds some missing pieces of documentation.

### Added

- [Privacy Policy example](docs/Privacy%20Policy.md) (#122)

## [2.0.0] - 2020-08-15

The first major back-end and front-end rewrite of Ackee with new API, dashboard, active visitors counter and more. Updating is as easy as ever. Simple grab the newest version, ensure that you're using Node.js v14 or higher and start Ackee. That's it!

### Added

- GraphQL API
- Overview with facts and data from all domains
- Facts card with live visitor counter, average visits and durations and the total number of visits today, this month and year
- New navigation that allows you to view stats by domain
- Keyboard shortcuts
- Switch between daily, monthly and yearly durations
- Click on a card headline to view more of this domain or insight
- Support `+srv` connection string modifier for MongoDB urls (#132, thanks @ericsandine)

### Changed

- Improved performance for all aggregations
- Show stale data while loading new data
- Removed detailed durations
- Delete records of a domain when deleting a domain
- Updated the required Node.js version and Docker Node.js version to v14
- Removed "All time" and replaced it with "Last 6 months" for performance reasons

### Fixed

- Sorting of yearly views

## [1.7.1] - 2020-05-15

### Added

- Instructions for using Helm (#109, thanks @suda)
- Instructions for using systemd (#112, thanks @LickABrick)
- Instructions on how to update when hosting on Heroku (#107, thanks @ckipp01)

## [1.7.0] - 2020-04-19

### Added

- Filter bar to quickly change what you're viewing
- [Documentation website](https://docs.ackee.electerious.com/#/)
- Browsers, devices and operating systems are now visible in the UI (thanks [@RomainCscn](https://github.com/RomainCscn))
- Browser and screen resolutions allow you to view width and height combined (thanks [@RomainCscn](https://github.com/RomainCscn))
- View the last 24 hours, 7 days, last 30 days or the top entries of all time (thanks [@RomainCscn](https://github.com/RomainCscn))

### Changed

- API returns more entries (25 -> 30)
- Loading design in header

## [1.6.1] - 2020-03-25

### Fixed

- Origin header check for multiple hosts (#84, thanks @jaryl)

## [1.6.0] - 2020-03-06

### Added

- Switch between daily, monthly and yearly views
- `ACKEE_ALLOW_ORIGIN` now supports multiple domains (#79 #82, thanks @jaryl)

### Changed

- JS error handling with React error boundary

### Fixed

- Loading indicator when the sizes-view is loading
- Catch errors when the sizes-view throws an error

## [1.5.0] - 2020-02-16

### Added

- Ackee can track detailed data ([optional](https://github.com/electerious/ackee-tracker#-options)) and now shows more of them in the "Detailed"-menu

## [1.4.3] - 2020-01-12

### Added

- Simply [deploy to Heroku](docs/Get%20started.md#with-heroku) by clicking one button (#72, thanks @aleccool213)
- `ACKEE_ALLOW_ORIGIN` option for [Platforms-As-A-Service](docs/CORS%20headers.md) (#73, thanks @aleccool213)

## [1.4.2] - 2019-12-19

### Changed

- Allow the use of `PORT` instead of `ACKEE_PORT` (#70)
- Improved parts of the documentation

## [1.4.1] - 2019-11-16

### Added

- Related modules in README

### Changed

- Click a Twitter link to see who tweeted the link

## [1.4.0] - 2019-11-05

### Added

- "New referrers"
- Custom tracker URL (#53)

### Fixed

- Incorrect content type for JS files (#54)

## [1.3.0] - 2019-10-19

### Added

- Average and detailed durations

### Changed

- Links now open in a new tab with `rel="noopener"`

### Fixed

- Remove username and password before logging MongoDB connection URI (#50)
- Horizontal scroll on pages with vertical scroll (#52)
- Large numbers in chart view overlapping bars
- "Last 7 days" now shows last 7 days instead of 8
- Title for "Unique site views"
- CORS headers in documentation
- Data fetched twice when navigating in UI
- Abort old fetch calls when they're triggered again

## [1.2.0] - 2019-09-21

### Added

- Top and recent languages
- Comparison bars for "Views per page"

### Changed

- Top and recent pages in a dedicated view
- Hover recent referrers to see the date
- Improved URL normalization for cleaner URLs in "Views per page" and "Referrers"
- Improved logging of errors in the server log
- Improved menu on small screens
- Reset state after pressing "Reload Ackee" in the error overlay to recover from bugs caused by a faulty state

## [1.1.0] - 2019-09-11

> ⚠️ All options / environment variables have been renamed. They're now starting with `ACKEE_` to avoid collisions with other tools. Please update your options accordingly.

### Added

- "Views per page" shows you the top 25 pages of a domain with the most views
- More documentation and FAQ
- Comparison bar behind items in the referrer list
- Normalize `siteLocation` before storing it in the database

### Changed

- "Total views" => "Total page views"
- "Unique views" => "Unique site views"
- `/domains/:domainId/views` response contains a new type

### Fixed

- Login not working because environment variables already in use (#45)

## [1.0.0] - 2019-09-03

### Added

- Everything
