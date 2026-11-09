/**
 * CLI: apply pending migrations.
 *
 * Run via `npm run db:migrate`. Reports what it did so CI logs show whether a
 * migration was actually pending.
 */
import { migrate, openDatabase, resolveDbPath } from './client.ts';

const path = resolveDbPath();
const sqlite = openDatabase();

try {
  const result = migrate(sqlite);
  if (result.applied.length === 0) {
    console.log(`up to date (${String(result.alreadyApplied.length)} migrations) at ${path}`);
  } else {
    console.log(`applied ${String(result.applied.length)} migration(s) at ${path}:`);
    for (const name of result.applied) console.log(`  + ${name}`);
  }
} finally {
  sqlite.close();
}
