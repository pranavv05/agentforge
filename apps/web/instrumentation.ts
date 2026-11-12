/**
 * Runs once when the server starts.
 *
 * Installs the compliance pack if the database does not hold the current version. A real
 * deployment runs `db:migrate`, not `db:seed` — the seed loads *fixtures* — and the pack
 * used to be installed only by the seed, so a fresh install had no rule pack and traceability
 * quietly produced nothing. Doing it at startup means it is true before the first request
 * rather than after the first call that happens to need it.
 *
 * Node only: the database driver is native and does not exist on the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;

  const { getDb } = await import('@agentforge/db');
  const { ensurePackInstalled } = await import('@agentforge/compliance');

  ensurePackInstalled(getDb());
}
