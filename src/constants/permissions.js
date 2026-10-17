// Atomic permissions. A role is a set of these, never a rank.
export const REPORTS_READ = 'REPORTS_READ'
export const DOMAINS_MANAGE = 'DOMAINS_MANAGE'
export const EVENTS_MANAGE = 'EVENTS_MANAGE'
export const TOKENS_MANAGE = 'TOKENS_MANAGE'
export const MEMBERS_MANAGE = 'MEMBERS_MANAGE'
export const AUDIT_READ = 'AUDIT_READ'

export const PERMISSIONS = [REPORTS_READ, DOMAINS_MANAGE, EVENTS_MANAGE, TOKENS_MANAGE, MEMBERS_MANAGE, AUDIT_READ]
