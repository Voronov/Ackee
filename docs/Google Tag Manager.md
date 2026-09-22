# Google Tag Manager

Ackee can be installed through Google Tag Manager instead of editing your site. This is
useful when you do not control the markup, or when the marketing team owns the container.

## What you need

The embed code from the domain dialog in Ackee. It looks like this:

```html
<script
  async
  src="https://ackee.example.com/tracker.js"
  data-ackee-server="https://ackee.example.com"
  data-ackee-domain-id="…"
></script>
```

Everything below reuses that code as it is. Nothing about Ackee has to change.

## Setting up the tag

1. In your container, create a new tag of type **Custom HTML**.
2. Paste the embed code into the HTML field.
3. Leave **Support document.write** unchecked. Ackee never uses it, and enabling it slows
   down every page it runs on.
4. Set the trigger to **All Pages**.
5. Publish the container.

That is the whole minimal setup. Ackee starts counting page views on the next page load.

## Single-page applications

A Custom HTML tag runs once per page load, so a site that changes the URL without loading a
new page records only the first view. Add a second trigger for the rest:

1. In **Variables**, enable the built-in **History Source** variable.
2. Create a trigger of type **History Change**.
3. Create a second **Custom HTML** tag with this body and attach the trigger to it:

```html
<script>
  ;(function () {
    var instance = window.ackeeTracker
    if (instance == null) return
    instance.create('https://ackee.example.com').record('…', window.ackeeTracker.attributes(true))
  })()
</script>
```

Replace the server address and the domain id with your own. The guard matters: the first tag
loads the tracker asynchronously, so on a fast navigation this code can run before it exists.

## Consent

Ackee stores nothing on the visitor's device and keeps no IP address, which is why it usually
needs no consent banner. If your container has a consent mode anyway, set **Additional
consent checks** to none for this tag rather than gating it behind marketing consent —
otherwise you measure only the visitors who agreed, and your numbers describe them instead
of your audience.

See [Anonymization](Anonymization.md) for what is and is not collected.

## Verifying

Use **Preview** in Tag Manager and open your site. The tag should fire once on load. The
visit appears in Ackee within a few seconds; the active visitors counter is the quickest
place to look.
