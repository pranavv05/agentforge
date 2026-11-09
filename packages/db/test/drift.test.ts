import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  ACTOR_TYPES,
  APPROVAL_DECISIONS,
  ARTIFACT_KINDS,
  COMPLIANCE_DOMAINS,
  COMPLIANCE_SEVERITIES,
  GROUNDING_FAILURES,
  LLM_STAGES,
  SPEC_MODES,
  SPEC_STATES,
  TASK_STATUSES,
} from '@agentforge/contract';
import { createDb, schema, type Db } from '../src/index.ts';

/**
 * Schema-drift guard.
 *
 * Three sources describe the same schema and all three must agree:
 *
 * 1. `migrations/0001_init.sql` — the DDL actually applied;
 * 2. `schema.ts` — the Drizzle mirror queries are typed against;
 * 3. the contract's state/enum arrays — the single place a name is spelled.
 *
 * Nothing stops them diverging except this test, and a divergence is nasty: queries
 * would typecheck against columns that do not exist, or a new state would be writable
 * in TypeScript and refused by a CHECK constraint at runtime.
 */

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentforge-drift-'));
  db = createDb(join(dir, 'drift.db'));
});

afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Table names present in the live database, excluding SQLite internals and FTS shadows. */
function liveTables(): Set<string> {
  const rows = db.$client
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'code_index_%'`,
    )
    .all();
  return new Set(rows.map((r) => r.name));
}

/** Column names of a live table. */
function liveColumns(table: string): Set<string> {
  const rows = db.$client
    .prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
    .all();
  return new Set(rows.map((r) => r.name));
}

/** The DDL text of a live table, for CHECK-constraint inspection. */
function tableSql(table: string): string {
  const row = db.$client
    .prepare<[string], { sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table);
  const sql = row?.sql;
  if (sql == null) throw new Error(`table ${table} has no DDL`);
  return sql;
}

/**
 * Extracts the literal list from a `CHECK (<column> IN ('a', 'b', ...))` constraint.
 *
 * Deliberately simple string handling: the DDL is ours, committed and reviewed, so a
 * full SQL parser would be more machinery than the job needs.
 */
function checkEnum(table: string, column: string): Set<string> {
  const sql = tableSql(table);
  const marker = `${column} IN (`;
  const start = sql.indexOf(marker);
  if (start === -1) {
    throw new Error(`no CHECK (... ${column} IN (...)) found on ${table}`);
  }
  const open = start + marker.length;
  const close = sql.indexOf(')', open);
  if (close === -1) throw new Error(`unterminated IN list for ${table}.${column}`);

  const values = sql
    .slice(open, close)
    .split(',')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .filter((v) => v.length > 0);

  return new Set(values);
}

/** Narrows an arbitrary schema export to a Drizzle table. */
function isSqliteTable(value: unknown): value is SQLiteTable {
  return value instanceof SQLiteTable;
}

/**
 * Every exported Drizzle table, paired with its SQL name.
 *
 * `schema` also exports non-table values (VIRTUAL_TABLES), so the filter is a real
 * narrowing rather than a cast.
 */
const drizzleTables = Object.values<unknown>(schema)
  .filter(isSqliteTable)
  .map((table) => ({ name: getTableConfig(table).name, table }));

describe('tables', () => {
  it('finds a non-trivial set of tables to compare', () => {
    expect(drizzleTables.length).toBeGreaterThanOrEqual(12);
  });

  it('declares every live table in the Drizzle mirror', () => {
    const declared = new Set(drizzleTables.map((t) => t.name));
    // `code_index` is an FTS5 virtual table, queried through raw SQL by design.
    declared.add('code_index');

    const missing = [...liveTables()].filter((t) => !declared.has(t));
    expect(missing, 'tables in the database but not in schema.ts').toEqual([]);
  });

  it('has a live table for every Drizzle declaration', () => {
    const live = liveTables();
    const missing = drizzleTables.filter((t) => !live.has(t.name)).map((t) => t.name);
    expect(missing, 'tables in schema.ts but not in the database').toEqual([]);
  });
});

describe('columns', () => {
  it.each(drizzleTables.map((t) => ({ name: t.name, table: t.table })))(
    '$name has matching columns in SQL and Drizzle',
    ({ name, table }) => {
      const declared = new Set(getTableConfig(table).columns.map((c) => c.name));
      const live = liveColumns(name);

      const missingInDb = [...declared].filter((c) => !live.has(c));
      const missingInMirror = [...live].filter((c) => !declared.has(c));

      expect(missingInDb, `declared in schema.ts but absent from ${name}`).toEqual([]);
      expect(missingInMirror, `present in ${name} but absent from schema.ts`).toEqual([]);
    },
  );
});

describe('CHECK constraints match the contract enums', () => {
  const cases: readonly { table: string; column: string; values: readonly string[] }[] = [
    { table: 'specs', column: 'status', values: SPEC_STATES },
    { table: 'specs', column: 'mode', values: SPEC_MODES },
    { table: 'artifact_versions', column: 'kind', values: ARTIFACT_KINDS },
    { table: 'approvals', column: 'artifact_kind', values: ARTIFACT_KINDS },
    { table: 'approvals', column: 'decision', values: APPROVAL_DECISIONS },
    { table: 'audit_log', column: 'actor_type', values: ACTOR_TYPES },
    { table: 'context_evidence', column: 'failure_reason', values: GROUNDING_FAILURES },
    { table: 'tasks', column: 'status', values: TASK_STATUSES },
    { table: 'compliance_rules', column: 'domain', values: COMPLIANCE_DOMAINS },
    { table: 'compliance_rules', column: 'severity', values: COMPLIANCE_SEVERITIES },
    { table: 'llm_calls', column: 'stage', values: LLM_STAGES },
  ];

  it.each(cases)('$table.$column', ({ table, column, values }) => {
    expect([...checkEnum(table, column)].sort()).toEqual([...values].sort());
  });
});

describe('indexes', () => {
  it('creates every index the Drizzle mirror declares', () => {
    const live = new Set(
      db.$client
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((r) => r.name),
    );

    const declared = drizzleTables.flatMap((t) =>
      getTableConfig(t.table).indexes.map((i) => i.config.name),
    );

    expect(declared.length).toBeGreaterThanOrEqual(15);
    const missing = declared.filter((n) => !live.has(n));
    expect(missing, 'indexes declared in schema.ts but absent from the database').toEqual([]);
  });
});

describe('migration integrity', () => {
  it('records the applied migration with its checksum', () => {
    const rows = db.select().from(schema.schemaMigrations).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('0001_init.sql');
    expect(rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent: a second migrate applies nothing', () => {
    const again = createDb(join(dir, 'drift.db'));
    expect(again.select().from(schema.schemaMigrations).all()).toHaveLength(1);
    again.$client.close();
  });

  it('enables foreign keys, so cascades actually fire', () => {
    const [row] = db.$client.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(row?.foreign_keys).toBe(1);
  });

  it('cascades deletes from specs to child rows', () => {
    db.$client
      .prepare(
        `INSERT INTO specs (id,title,description,mode,repo_path,status,version,created_by,created_at,updated_at)
         VALUES ('cascade_spec','t','d','greenfield',NULL,'CREATED',0,'me','x','x')`,
      )
      .run();
    db.$client
      .prepare(
        `INSERT INTO clarifications (id,spec_id,round,question,why_it_matters,options,answer,answered_by,answered_at,created_at)
         VALUES ('clr_x','cascade_spec',1,'q','w','[]',NULL,NULL,NULL,'x')`,
      )
      .run();

    db.$client.prepare("DELETE FROM specs WHERE id = 'cascade_spec'").run();

    const left = db.$client
      .prepare<[], { c: number }>(
        "SELECT count(*) AS c FROM clarifications WHERE spec_id = 'cascade_spec'",
      )
      .get();
    expect(left?.c).toBe(0);
  });
});
