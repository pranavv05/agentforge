import type { Db } from '@agentforge/db';
import type { SpecState } from '@agentforge/contract';
import type { ThreadItem } from '@/lib/thread';

/**
 * What the browser needs to tell a run that is working from one that has stopped.
 *
 * Nothing in the database says a run is alive, so liveness has to be inferred from two
 * timestamps the system already records: when the spec entered its current state, and
 * when a model call last finished for it. Both are server times. `serverNow` travels with
 * them so the browser can correct for its own clock being wrong — a laptop five minutes
 * fast would otherwise declare every run quiet the moment the page loaded.
 */
export interface RunActivity {
  readonly enteredAt: string | null;
  readonly lastCallAt: string | null;
  readonly serverNow: string;
}

export function runActivity(
  db: Db,
  specId: string,
  status: SpecState,
  items: readonly ThreadItem[],
): RunActivity {
  // The most recent time the spec moved *into* the state it is in now.
  let enteredAt: string | null = null;
  for (const item of items) {
    if (item.type === 'activity' && item.toState === status) enteredAt = item.at;
  }

  const row = db.$client
    .prepare('SELECT max(created_at) AS at FROM llm_calls WHERE spec_id = ?')
    .get(specId) as { at: string | null } | undefined;

  return { enteredAt, lastCallAt: row?.at ?? null, serverNow: new Date().toISOString() };
}
