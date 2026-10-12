// Every domain that existed before workspaces, and every domain the env admin creates,
// lives here. Migrations in v2.1 move domains out of it (ADR-002).
export const DEFAULT_WORKSPACE_ID = 'default'

// Bumped when a stored shape changes, so a migration knows which documents to touch.
export const SCHEMA_VERSION = 1
