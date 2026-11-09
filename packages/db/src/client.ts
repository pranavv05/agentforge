import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

/**
 * Database connection and migration runner.
 *
 * SQLite is the system of record. The pragmas below are not incidental:
 * - `foreign_keys = ON` because SQLite disables them per-connection by default, and
 *   every cascade in the schema depends on it;
 * - `journal_mode = WAL` so a reader (the PreToolUse hook, which must answer fast and
 *   never block) is never held up by a writer;
 * - `busy_timeout` so concurrent writers wait briefly instead of failing outright,
 *   which matters once the orchestrator and the hook share one file.
 */

/**
 * Drizzle handle. `$client` is Drizzle's own escape hatch to the underlying
 * better-sqlite3 connection, used for DDL, pragmas and the FTS5 queries that have no
 * Drizzle representation.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteDatabase };

const PACKAGE_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(PACKAGE_SRC_DIR, 'migrations');

/**
 * The repository root, derived from this file's own location (packages/db/src).
 *
 * Deliberately not `process.cwd()`: the CLI scripts run from the repo root while the
 * Next dev server runs from `apps/web`, so a cwd-relative default would silently point
 * the two at different database files — one of them empty.
 */
export const REPO_ROOT = resolve(PACKAGE_SRC_DIR, '..', '..', '..');

/**
 * Resolves the configured database path.
 *
 * An absolute `SDD_DB_PATH` is used as given; a relative one resolves against the
 * repository root, so every entry point agrees on which file is the database.
 */
export function resolveDbPath(explicit?: string): string {
  const configured = explicit ?? process.env['SDD_DB_PATH'] ?? './data/agentforge.db';
  if (isAbsolute(configured)) return configured;
  // Dynamic by nature (runtime configuration); the opt-out stops Turbopack tracing the
  // whole project into the server bundle.
  return resolve(/*turbopackIgnore: true*/ REPO_ROOT, configured);
}

/**
 * Opens a connection and applies the pragmas.
 *
 * `:memory:` is accepted for tests, though suites that exercise concurrency should use
 * a real temp file: an in-memory database is per-connection, so two handles would not
 * see each other.
 */
export function openDatabase(path?: string): SqliteDatabase {
  const dbPath = path === ':memory:' ? ':memory:' : resolveDbPath(path);

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);

  sqlite.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');

  return sqlite;
}

/** Wraps a connection in Drizzle. The raw handle stays reachable as `db.$client`. */
export function wrap(sqlite: SqliteDatabase): Db {
  return drizzle(sqlite, { schema });
}

interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/** Reads migrations in filename order. Names are zero-padded, so lexical order is correct. */
export function loadMigrations(): readonly Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

/**
 * Applies pending migrations.
 *
 * Each migration runs inside a transaction, and an already-applied migration whose
 * file has since changed is a hard error rather than a no-op — otherwise a schema edit
 * would appear to succeed locally while leaving every other database behind.
 */
export function migrate(sqlite: SqliteDatabase): MigrateResult {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      checksum   TEXT NOT NULL
    );
  `);

  const recorded = new Map(
    sqlite
      .prepare<[], { name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations',
      )
      .all()
      .map((row) => [row.name, row.checksum] as const),
  );

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of loadMigrations()) {
    const existing = recorded.get(migration.name);

    if (existing !== undefined) {
      if (existing !== migration.checksum) {
        throw new Error(
          `migration ${migration.name} was already applied but its contents have changed ` +
            `(recorded ${existing.slice(0, 12)}, file ${migration.checksum.slice(0, 12)}). ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
      alreadyApplied.push(migration.name);
      continue;
    }

    // DDL plus its bookkeeping row commit together, so a crash mid-migration cannot
    // leave the schema half-applied but marked done.
    const run = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      sqlite
        .prepare('INSERT INTO schema_migrations (name, applied_at, checksum) VALUES (?, ?, ?)')
        .run(migration.name, new Date().toISOString(), migration.checksum);
    });
    run();

    applied.push(migration.name);
  }

  return { applied, alreadyApplied };
}

/** Opens, migrates and wraps in one call. The normal entry point for application code. */
export function createDb(path?: string): Db {
  const sqlite = openDatabase(path);
  migrate(sqlite);
  return wrap(sqlite);
}

let singleton: Db | null = null;

/**
 * The process-wide connection.
 *
 * Next.js route handlers reuse one connection rather than opening a file handle per
 * request; `better-sqlite3` is synchronous, so there is no pool to manage.
 */
export function getDb(): Db {
  singleton ??= createDb();
  return singleton;
}

/** Closes and clears the singleton. Tests use this between suites. */
export function closeDb(): void {
  if (singleton !== null) {
    singleton.$client.close();
    singleton = null;
  }
}
