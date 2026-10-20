import { randomUUID } from 'node:crypto'

import {
  DEFAULT_DOWNLOAD_EXTENSIONS,
  GTM_ID,
  KIND_OF_RULE,
  KINDS,
  MAXIMUM_EXTENSIONS,
  MAXIMUM_LABEL_LENGTH,
  MAXIMUM_PATH_LENGTH,
  MAXIMUM_RULES,
  MAXIMUM_SELECTOR_LENGTH,
  RULE_TYPES,
} from '../constants/tracking.js'
import Domain from '../models/Domain.js'
import Event from '../models/Event.js'

/*
 * Tracking rules of a domain (ACKEE-25): what the site collects besides page views, and the
 * Google Tag Manager container it loads. Set up in Ackee, served to the site by /t/<id>.js.
 */
const response = (tracking = {}) => ({
  gtmId: tracking.gtmId ?? '',
  outbound: tracking.outbound === true,
  downloads: tracking.downloads === true,
  downloadExtensions:
    tracking.downloadExtensions?.length > 0 ? [...tracking.downloadExtensions] : DEFAULT_DOWNLOAD_EXTENSIONS,
  scroll: tracking.scroll === true,
  vitals: tracking.vitals === true,
  rules: (tracking.rules ?? []).map(({ id, type, selector, label, path }) => ({
    id,
    type,
    selector,
    label,
    path: path ?? '',
  })),
  events: Object.fromEntries(tracking.events instanceof Map ? tracking.events : Object.entries(tracking.events ?? {})),
})

export const of = (domain) => response(domain.tracking)

// The reason the input is refused, or null. A selector goes into a page's querySelector, so it
// must not be able to break out of the script it is served in.
const refusal = (input) => {
  if ((input.gtmId ?? '') !== '' && GTM_ID.test(input.gtmId) === false) {
    return 'A Tag Manager container id looks like GTM-ABC1234'
  }

  const rules = input.rules ?? []
  if (rules.length > MAXIMUM_RULES) return `At most ${MAXIMUM_RULES} rules per domain`

  for (const rule of rules) {
    if (RULE_TYPES.includes(rule.type) === false) return `Unknown rule type ${rule.type}`
    const selector = String(rule.selector ?? '').trim()
    if (selector === '' || selector.length > MAXIMUM_SELECTOR_LENGTH) {
      return `A selector needs 1 to ${MAXIMUM_SELECTOR_LENGTH} characters`
    }
    if (/[<>`]/.test(selector)) return 'A selector cannot contain <, > or `'
    const label = String(rule.label ?? '').trim()
    if (label === '' || label.length > MAXIMUM_LABEL_LENGTH)
      return `A name needs 1 to ${MAXIMUM_LABEL_LENGTH} characters`
    const path = String(rule.path ?? '').trim()
    if (path !== '' && (path.startsWith('/') === false || path.length > MAXIMUM_PATH_LENGTH || /[<>`\s]/.test(path))) {
      return 'A page is a path like /product/* or /checkout/, without spaces'
    }
  }

  const extensions = input.downloadExtensions ?? []
  if (extensions.length > MAXIMUM_EXTENSIONS) return `At most ${MAXIMUM_EXTENSIONS} file extensions`
  if (extensions.some((extension) => /^[a-z\d]{1,8}$/.test(extension) === false)) {
    return 'A file extension is 1 to 8 lower-case letters or digits, without the dot'
  }

  return null
}

// The kinds the settings switch on
const kindsIn = (tracking) =>
  new Set([
    ...tracking.rules.map((rule) => KIND_OF_RULE[rule.type]),
    ...['outbound', 'downloads', 'scroll', 'vitals'].filter((kind) => tracking[kind] === true),
  ])

// Every kind in use gets its event in the domain's workspace, once. One deleted by hand comes back.
const ensureEvents = async (domain, tracking) => {
  const events = { ...tracking.events }

  for (const kind of kindsIn(tracking)) {
    const existing = events[kind] == null ? null : await Event.findOne({ id: events[kind] }).lean()
    if (existing != null) continue

    const event = await Event.create({
      title: `${domain.title} · ${KINDS[kind].title}`,
      type: KINDS[kind].type,
      workspaceId: domain.workspaceId,
    })
    events[kind] = event.id
  }

  return events
}

// Saves the settings of a domain in the scope (see utils/permissions.js). A string is a refusal,
// null an unknown domain.
export const update = async (domainId, input, within) => {
  const reason = refusal(input)
  if (reason != null) return reason

  const domain = await Domain.findOne({ id: domainId, ...within })
  if (domain == null) return null

  const previous = of(domain)
  const tracking = {
    gtmId: input.gtmId ?? '',
    outbound: input.outbound === true,
    downloads: input.downloads === true,
    downloadExtensions: input.downloadExtensions?.length > 0 ? input.downloadExtensions : undefined,
    scroll: input.scroll === true,
    vitals: input.vitals === true,
    // A rule keeps its id while it exists, so the interface can tell rules apart
    rules: (input.rules ?? []).map((rule) => ({
      id: rule.id ?? randomUUID(),
      type: rule.type,
      selector: rule.selector.trim(),
      label: rule.label.trim(),
      path: String(rule.path ?? '').trim(),
    })),
    events: previous.events,
  }

  tracking.events = await ensureEvents(domain, response(tracking))

  domain.tracking = tracking
  domain.updated = Date.now()
  await domain.save()

  return { domain, tracking: of(domain) }
}
