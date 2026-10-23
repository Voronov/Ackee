/*
 * Runs on the site, not in Ackee (ACKEE-25). The server puts this function into /t/<id>.js as
 * text, after the tracker, and calls it with the domain's settings. So it must not use anything
 * from outside its own body: no imports, no module variables.
 *
 * It records the page view like the plain snippet does, then collects what the owner switched
 * on. Only names and counts leave the page: never what someone typed, never a cookie.
 */
export default function autotrack(config) {
  const tracker = globalThis.ackeeTracker
  if (tracker == null) return

  // Where to report: the address the owner set, or the one this script was loaded from
  const script = document.currentScript
  const server = config.server || (script?.src ? new URL(script.src).origin : null)
  if (server == null) return

  const instance = tracker.create(server, { detailed: false, ignoreLocalhost: config.ignoreLocalhost })
  const send = (kind, key, value = 1) => {
    const eventId = config.events[kind]
    if (eventId != null) instance.action(eventId, { key: String(key).slice(0, 500), value })
  }

  // Google Tag Manager, with the code Google gives for its container
  if (config.gtmId) {
    globalThis.dataLayer = globalThis.dataLayer || []
    globalThis.dataLayer.push({ 'gtm.start': Date.now(), 'event': 'gtm.js' })
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(config.gtmId)}`
    document.head.append(script)
  }

  // A selector that does not parse matches nothing, rather than stopping everything else
  const matches = (element, selector) => {
    try {
      return element instanceof Element && element.closest(selector) != null
    } catch {
      return false
    }
  }

  // A rule's page: /product/* matches everything below /product/. Empty means every page.
  const onPage = (rule) => {
    if (!rule.path) return true
    const pattern = rule.path.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replaceAll('*', '.*')
    return new RegExp(`^${pattern}$`).test(location.pathname)
  }

  // Read on every use, so a single-page app that changes the address gets the rules of its new page
  const rulesOf = (type) => config.rules.filter((rule) => rule.type === type && onPage(rule))

  // A page view per address, also in single-page apps that change it without loading a page
  let view = instance.record(config.domainId)
  let scrolled = new Set()
  let seen = new WeakSet()

  const onNewPage = () => {
    view.stop()
    view = instance.record(config.domainId)
    scrolled = new Set()
    seen = new WeakSet()
    observeAll()
  }

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method]
    history[method] = function (...args) {
      const before = location.pathname
      const result = original.apply(this, args)
      if (location.pathname !== before) onNewPage()
      return result
    }
  }
  globalThis.addEventListener('popstate', onNewPage)

  // Clicks on the owner's elements, links to other sites and downloads
  document.addEventListener(
    'click',
    (event) => {
      for (const rule of rulesOf('CLICK')) if (matches(event.target, rule.selector)) send('clicks', rule.label)

      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (link == null) return

      const url = new URL(link.href, location.href)
      if (['http:', 'https:'].includes(url.protocol) === false) return

      if (config.outbound && url.hostname !== location.hostname) send('outbound', url.hostname)

      const file = url.pathname.split('/').pop()
      const extension = file.includes('.') ? file.split('.').pop().toLowerCase() : ''
      if (config.downloads && config.downloadExtensions.includes(extension)) send('downloads', file)
    },
    true,
  )

  // That a form was sent, never what was in it
  document.addEventListener(
    'submit',
    (event) => {
      for (const rule of rulesOf('FORM')) if (matches(event.target, rule.selector)) send('forms', rule.label)
    },
    true,
  )

  // An element counts as seen once half of it stayed on screen for a second
  // Any rule of this kind on any page decides whether to watch at all
  const anyVisible = config.rules.some((rule) => rule.type === 'VISIBLE')
  const timers = new WeakMap()
  const observer =
    anyVisible && 'IntersectionObserver' in globalThis
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const element = entry.target
              if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && seen.has(element) === false) {
                timers.set(
                  element,
                  setTimeout(() => {
                    seen.add(element)
                    for (const rule of rulesOf('VISIBLE')) if (matches(element, rule.selector)) send('seen', rule.label)
                  }, 1000),
                )
              } else {
                clearTimeout(timers.get(element))
              }
            }
          },
          { threshold: [0, 0.5, 1] },
        )
      : null

  const watched = new WeakSet()
  // Called again on every new page of a single-page app, after this line has run
  const observeAll = () => {
    if (observer == null) return
    for (const rule of rulesOf('VISIBLE')) {
      let elements = []
      try {
        elements = document.querySelectorAll(rule.selector)
      } catch {
        // A selector that does not parse watches nothing
      }
      for (const element of elements) {
        if (watched.has(element)) continue
        watched.add(element)
        observer.observe(element)
      }
    }
  }

  observeAll()
  if (observer != null) {
    let pending = null
    new MutationObserver(() => {
      clearTimeout(pending)
      pending = setTimeout(observeAll, 200)
    }).observe(document.documentElement, { childList: true, subtree: true })
  }

  // How far down the page people get
  if (config.scroll) {
    let ticking = false
    globalThis.addEventListener(
      'scroll',
      () => {
        if (ticking) return
        ticking = true
        requestAnimationFrame(() => {
          ticking = false
          const root = document.documentElement
          const depth = ((globalThis.scrollY + globalThis.innerHeight) / root.scrollHeight) * 100
          for (const mark of [25, 50, 75, 100]) {
            if (depth >= mark - 1 && scrolled.has(mark) === false) {
              scrolled.add(mark)
              send('scroll', `${mark}%`)
            }
          }
        })
      },
      { passive: true },
    )
  }

  // Core Web Vitals, sent once when the page is hidden. CLS is multiplied by 1000 so it fits an
  // average of whole numbers.
  if (config.vitals && 'PerformanceObserver' in globalThis) {
    const vitals = { lcp: null, cls: 0, inp: null }
    const observe = (type, callback, options = {}) => {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) callback(entry)
        }).observe({ type, buffered: true, ...options })
      } catch {
        // A browser without this entry type reports the other vitals
      }
    }
    observe('largest-contentful-paint', (entry) => {
      vitals.lcp = entry.startTime
    })
    observe('layout-shift', (entry) => {
      if (entry.hadRecentInput === false) vitals.cls += entry.value
    })
    observe(
      'event',
      (entry) => {
        if (entry.interactionId > 0) vitals.inp = Math.max(vitals.inp ?? 0, entry.duration)
      },
      { durationThreshold: 40 },
    )

    let sent = false
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || sent) return
      sent = true
      if (vitals.lcp != null) send('vitals', 'LCP, ms', Math.round(vitals.lcp))
      if (vitals.inp != null) send('vitals', 'INP, ms', Math.round(vitals.inp))
      send('vitals', 'CLS × 1000', Math.round(vitals.cls * 1000))
    })
  }
}
