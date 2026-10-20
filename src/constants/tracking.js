import { EVENTS_TYPE_AVERAGE_LIST, EVENTS_TYPE_TOTAL_LIST } from './events.js'

// What a site can collect besides page views, set up in Ackee instead of in the site's code
// (ACKEE-25). Every kind is an Ackee event of the domain's workspace, so the reports exist already.
export const RULE_CLICK = 'CLICK'
export const RULE_VISIBLE = 'VISIBLE'
export const RULE_FORM = 'FORM'
export const RULE_TYPES = [RULE_CLICK, RULE_VISIBLE, RULE_FORM]

// One event per kind and domain, created when the kind is first switched on
export const KINDS = {
  clicks: { title: 'Clicks', type: EVENTS_TYPE_TOTAL_LIST },
  seen: { title: 'Seen', type: EVENTS_TYPE_TOTAL_LIST },
  forms: { title: 'Form submissions', type: EVENTS_TYPE_TOTAL_LIST },
  outbound: { title: 'Outbound links', type: EVENTS_TYPE_TOTAL_LIST },
  downloads: { title: 'Downloads', type: EVENTS_TYPE_TOTAL_LIST },
  scroll: { title: 'Scroll depth', type: EVENTS_TYPE_TOTAL_LIST },
  vitals: { title: 'Web Vitals', type: EVENTS_TYPE_AVERAGE_LIST },
}

export const KIND_OF_RULE = { [RULE_CLICK]: 'clicks', [RULE_VISIBLE]: 'seen', [RULE_FORM]: 'forms' }

export const DEFAULT_DOWNLOAD_EXTENSIONS = ['pdf', 'zip', 'docx', 'xlsx', 'pptx', 'csv', 'dmg', 'exe']

export const MAXIMUM_RULES = 50
export const MAXIMUM_SELECTOR_LENGTH = 200
export const MAXIMUM_LABEL_LENGTH = 100
export const MAXIMUM_PATH_LENGTH = 200
export const MAXIMUM_EXTENSIONS = 20

// The container id Google shows in Tag Manager, like GTM-ABC1234
export const GTM_ID = /^GTM-[A-Z\d]{4,10}$/
