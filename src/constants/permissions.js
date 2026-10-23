// Atomic permissions. A role is a set of these, never a rank.
export const REPORTS_READ = 'REPORTS_READ'
export const DOMAINS_MANAGE = 'DOMAINS_MANAGE'
export const EVENTS_MANAGE = 'EVENTS_MANAGE'
export const TOKENS_MANAGE = 'TOKENS_MANAGE'
export const MEMBERS_MANAGE = 'MEMBERS_MANAGE'
export const AUDIT_READ = 'AUDIT_READ'
// The Tag Manager container of a domain: any code of its owner on the site (ACKEE-25)
export const GTM_MANAGE = 'GTM_MANAGE'

export const PERMISSIONS = [
  REPORTS_READ,
  DOMAINS_MANAGE,
  EVENTS_MANAGE,
  TOKENS_MANAGE,
  MEMBERS_MANAGE,
  AUDIT_READ,
  GTM_MANAGE,
]
