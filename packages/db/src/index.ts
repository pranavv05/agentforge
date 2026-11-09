/**
 * `@agentforge/db` — SQLite access layer.
 *
 * Exposes the connection, the migration runner, the Drizzle table definitions and the
 * validated JSON-column helpers. Business rules live in `@agentforge/orchestrator`;
 * this package only knows how to store and retrieve rows.
 */

export * as schema from './schema.ts';
export {
  closeDb,
  createDb,
  getDb,
  loadMigrations,
  migrate,
  openDatabase,
  REPO_ROOT,
  resolveDbPath,
  wrap,
  type Db,
  type MigrateResult,
} from './client.ts';
export {
  canonicalize,
  contentHashOf,
  fromSqliteBool,
  parseJsonColumn,
  sha256Hex,
  toJsonColumn,
  toSqliteBool,
} from './json.ts';
