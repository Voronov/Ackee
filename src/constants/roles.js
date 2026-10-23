import {
  AUDIT_READ,
  DOMAINS_MANAGE,
  EVENTS_MANAGE,
  GTM_MANAGE,
  MEMBERS_MANAGE,
  REPORTS_READ,
  TOKENS_MANAGE,
} from './permissions.js'

// Roles inside a workspace.
export const ROLE_VIEWER = 'VIEWER'
export const ROLE_EDITOR = 'EDITOR'
export const ROLE_OWNER = 'OWNER'

export const ROLES = [ROLE_VIEWER, ROLE_EDITOR, ROLE_OWNER]

// The roles every install has. A `Role` document with the same name overrides one, and a
// document with a new name adds a role, both without a release.
export const BUILT_IN_ROLES = {
  [ROLE_VIEWER]: [REPORTS_READ],
  [ROLE_EDITOR]: [REPORTS_READ, DOMAINS_MANAGE, EVENTS_MANAGE],
  [ROLE_OWNER]: [REPORTS_READ, DOMAINS_MANAGE, EVENTS_MANAGE, TOKENS_MANAGE, MEMBERS_MANAGE, AUDIT_READ, GTM_MANAGE],
}
