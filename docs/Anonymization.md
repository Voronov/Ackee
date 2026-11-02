# Anonymization

Ackee tries its best to keep tracked data anonymized. Several steps are used to avoid that users are identifiable, while still providing helpful analytics.

## User identifier

Ackee uses the IP, user-agent and domainId to identify a user. All information will be hashed together with a [salt](<https://en.wikipedia.org/wiki/Salt_(cryptography)>) that changes daily. The final hash is called `clientId`.

The daily salt is never stored anywhere. It avoids that database backups can be used to stick data together to reconstruct the browsing history of a user.

With [`ACKEE_REDIS`](Options.md#redis) the processes share the salt through Redis. It stays in Redis for 25 hours at most and, with persistence turned off, only in memory.

With the [ingest queue](Options.md#ingest-queue) a view waits in Redis until the worker writes it. The queued view holds the identification and the device fields that the next view of the same visitor would remove, but never the IP address or the user agent it was computed from. It is deleted from the stream as soon as it is written. The queue runs on its own Redis with persistence, though, so its append-only file keeps such views until Redis rewrites the file. Leave that file out of backups and let Redis rewrite it often. The salt stays in the Redis of `ACKEE_REDIS` and never reaches the queue.

Ackee also removes personal data from previous records when a new record with an existing identification gets added. This way the user identifier and other identifiable data is only stored once in the database. Or with other words: Ackee forgets who you are as soon as it sees you, again. It's not possible to reconstruct a browsing history from the stored data, even on a daily basis. Someone who watches the [live feed](#live-feed) at the time of the visit sees more, see below.

## Live feed

The [live feed](API.md#live-feed) shows each new view as it is written: the page, the referrer and source, and, for views with personal data, the language, browser, OS and device. It never sends the identification (`clientId`), the IP address, the user agent, the id of the record, versions, screen sizes or the country.

The fields are the same as in the reports, but the feed shows more than the reports do:

- A report lists each dimension on its own. A row of the feed puts the fields of one view together: this page, from this referrer, in this browser on this device.
- With personal data, the views of one visitor can be matched while the feed is open: the same language, browser, OS and device on page after page. Personal data is only recorded when the site owner turns on `detailed` in the tracker.
- Whoever watches can match a view with a person they know is visiting the site right now.
- Each Ackee process keeps the last 20 views of every watched domain in memory, with their personal data, until a minute after the last viewer of that domain left. That includes views whose personal data was already removed from the database by the next view of the same visitor.

That is the purpose of the feature, so give access to reports (`REPORTS_READ`) only to people who may see this.

## Personal data

Ackee won't track personal information by default, but it has the ability to do so in a privacy focused way. Our recommendation:

1. Ask the user for permission to track personal data and set a cookie to remember their decision
2. Enable `detailed` with the next page view (an option of [ackee-tracker](https://github.com/electerious/ackee-tracker))
3. Ackee now receives data considered as "personal data"

The following data is considered as "personal data":

| Name               | Description                                                                   |
| :----------------- | :---------------------------------------------------------------------------- |
| siteLanguage       | Language version of the browser.                                              |
| screenWidth        | The width of the screen in pixels.                                            |
| screenHeight       | The height of the screen in pixels.                                           |
| screenColorDepth   | The bit depth of the color palette for displaying images (in bits per pixel). |
| deviceName         | The name of the product hosting the browser.                                  |
| deviceManufacturer | The name of the product's manufacturer.                                       |
| osName             | The family of the OS.                                                         |
| osVersion          | The version of the OS.                                                        |
| browserName        | The name of the browser/environment.                                          |
| browserVersion     | The browser/environment version.                                              |
| browserWidth       | The width of the screen in pixels.                                            |
| browserHeight      | The height of the screen in pixels.                                           |
| country            | The country of the visitor, see below.                                        |

All those parameters are considered as personal data, because you could point at the tracked person when sitting in the same room (even when this is probably never the case and totally unrealistic).

`country` is different from the others: the tracker does not send it, and `detailed` has nothing to do with it. When the owner of the domain turned it on and the instance offers it ([Options](Options.md#country-of-visitors)), the server reads the country from the address of the request, on this server and nowhere else, keeps the two-letter code with the view and forgets the address as before. The next visit of the same person removes it from the earlier views like the other personal data.

`siteReferrer` and visit duration (calculated using the creation and update time of a record) is not considered as personal data as you won't be able to identify a user with this piece of information. Even when you are in the same room you would need access to the browsing history of the user.
