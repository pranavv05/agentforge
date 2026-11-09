/**
 * CLI: delete the database file and re-apply migrations from scratch.
 *
 * Development convenience only. Refuses to run unless the resolved path sits inside the
 * repository, so a misconfigured SDD_DB_PATH cannot delete something else.
 */
import { rmSync } from 'node:fs';
import { relative } from 'node:path';
import { REPO_ROOT, migrate, openDatabase, resolveDbPath } from './client.ts';

const path = resolveDbPath();
const rel = relative(REPO_ROOT, path);

// Guard against the repository root rather than the working directory, so the check
// does not depend on where the script was invoked from.
if (rel.startsWith('..')) {
  console.error(`refusing to reset ${path}: it is outside the repository`);
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${path}${suffix}`, { force: true });
}
console.log(`removed ${rel}`);

const sqlite = openDatabase();
try {
  const result = migrate(sqlite);
  console.log(`re-applied ${String(result.applied.length)} migration(s)`);
} finally {
  sqlite.close();
}
