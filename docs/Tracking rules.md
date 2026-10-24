# Tracking rules

Ackee can collect more than page views, set up in Ackee instead of in your site's code. Your site needs one snippet; every change in Ackee reaches it within a minute.

## The snippet

Open a domain under Settings → Domains and copy **Embed code with tracking rules**:

```html
<script async src="https://ackee.example.com/t/<domain id>.<ingest key>.js"></script>
```

It replaces the plain snippet: it records page views like before, including the pages of a single-page app, and applies the rules below. Use one or the other, not both.

Set `ACKEE_URL` on the server (see [Options](Options.md)), so the snippet carries the address of Ackee. Without it the snippet reports to the address it was loaded from, which it reads from the page; on a page where visitors can place HTML, that reading can be forged, and then the snippet does not start at all.

## What it can collect

Under **Tracking rules →** in the domain dialog:

| Kind                 | What is collected                                           | Set up with                                          |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Click                | clicks on an element                                        | a CSS selector and a name, like `#buy` "Add to cart" |
| Seen                 | an element that stayed at least half on screen for a second | a selector and a name, like `.pricing`               |
| Form sent            | that a form was sent, never what was in it                  | a selector and a name                                |
| Links to other sites | clicks on links to another host; the report shows the host  | a switch                                             |
| File downloads       | clicks on links to files; the report shows the file name    | a switch and the file types                          |
| Scroll depth         | 25, 50, 75 and 100 % of the page                            | a switch                                             |
| Page speed           | LCP and INP in milliseconds, CLS multiplied by 1000         | a switch                                             |

A domain can have up to 50 rules of any kind at once. Each rule can be limited to some pages: `/product/*` matches every page under `/product/`, `/checkout/` only that page, and an empty field every page. `*` stands for anything; the query string and the part after `#` are not compared.

Every kind is an Ackee event of the domain's workspace, named after the domain, like "shop.example.com · Clicks". Its reports are under Insights → Events.

## Google Tag Manager

Enter the container id, like `GTM-ABC1234`, and the snippet loads Tag Manager with Google's own code. Ackee itself stays without cookies; the tags in your container may not, and that is up to you. Ackee does not run any other code of yours on the site. A container can run any code on the site, so only an owner of the workspace sets or changes it, and the audit log keeps the old and the new id.

## Privacy

- Only names and counts are sent: never what someone typed into a field, never a cookie, no new identifier.
- Localhost and bots are ignored, as by the plain tracker.

## Good to know

- A link that opens in the same tab may leave the page before its click is sent. Most browsers send it, but not all of them every time. Links that open in a new tab are not affected.
- The ingest key in the snippet works like in the plain one. After rotating the key, update the snippet on your site.
- A selector that does not exist on a page matches nothing there; it does not break the other rules.
