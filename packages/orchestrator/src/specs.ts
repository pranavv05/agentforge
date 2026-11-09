import {
  type CreateSpecRequest,
  type ListSpecsQuery,
  NotFoundError,
  type SpecMode,
  type SpecState,
  ValidationError,
} from '@agentforge/contract';
import { type Db, schema } from '@agentforge/db';
import { and, count, desc, eq } from 'drizzle-orm';
import { isAbsolute, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { newId } from './ids.ts';
import { newCorrelationId, runLogger } from './logger.ts';
import { appendAudit } from './transition.ts';
import type { Actor, SpecRow } from './types.ts';

/**
 * Spec creation and retrieval.
 *
 * Creation is the one place a spec's status is set without going through
 * `transition()`: there is no prior state to move from. It still writes an audit entry
 * (with `from_state` null) so the audit log is a complete history from the first row.
 */

export interface CreateSpecInput extends CreateSpecRequest {
  readonly actor: Actor;
  readonly correlationId?: string;
}

/**
 * Validates and normalises a brownfield spec's repository path.
 *
 * The path is resolved to an absolute real path once, here, and every file tool is
 * later confined beneath it. A path that is not an existing directory is rejected now
 * rather than failing deep inside a scan.
 */
function normaliseRepoPath(repoPath: string): string {
  // The repository under analysis is supplied per spec, so this resolve is dynamic by
  // nature; the opt-out keeps Turbopack from tracing the whole project into the bundle.
  const resolved = isAbsolute(repoPath)
    ? repoPath
    : resolve(/*turbopackIgnore: true*/ process.cwd(), repoPath);

  let stat;
  try {
    stat = statSync(resolved);
  } catch (cause) {
    throw new ValidationError(`repo_path does not exist: ${resolved}`, {
      repo_path: resolved,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!stat.isDirectory()) {
    throw new ValidationError(`repo_path is not a directory: ${resolved}`, {
      repo_path: resolved,
    });
  }

  return resolved;
}

export function createSpec(db: Db, input: CreateSpecInput): SpecRow {
  const correlationId = input.correlationId ?? newCorrelationId();

  // The contract already enforces the mode/repo_path pairing; this re-checks it because
  // `createSpec` is also reachable from the seed script and the eval harness.
  if (input.mode === 'brownfield' && input.repo_path === null) {
    throw new ValidationError('brownfield specs require a repo_path');
  }
  if (input.mode === 'greenfield' && input.repo_path !== null) {
    throw new ValidationError('greenfield specs must not set a repo_path');
  }

  const repoPath = input.repo_path === null ? null : normaliseRepoPath(input.repo_path);
  const now = new Date().toISOString();

  const row: SpecRow = {
    id: newId('spec'),
    title: input.title,
    description: input.description,
    mode: input.mode,
    repoPath,
    status: 'CREATED',
    version: 0,
    createdBy: input.actor.id,
    createdAt: now,
    updatedAt: now,
  };

  db.transaction(
    (tx) => {
      tx.insert(schema.specs).values(row).run();
      appendAudit(tx, {
        specId: row.id,
        fromState: null,
        toState: 'CREATED',
        actor: input.actor,
        reason: 'Spec created.',
        payload: { mode: input.mode, repo_path: repoPath },
        correlationId,
      });
    },
    { behavior: 'immediate' },
  );

  runLogger(correlationId, { spec_id: row.id }).info(
    { mode: row.mode, title: row.title },
    'spec created',
  );

  return row;
}

export function getSpec(db: Db, specId: string): SpecRow | undefined {
  return db.select().from(schema.specs).where(eq(schema.specs.id, specId)).limit(1).all()[0];
}

export function requireSpecById(db: Db, specId: string): SpecRow {
  const spec = getSpec(db, specId);
  if (spec === undefined) {
    throw new NotFoundError(`spec ${specId} does not exist`, { spec_id: specId });
  }
  return spec;
}

export interface ListSpecsResult {
  readonly specs: readonly SpecRow[];
  readonly total: number;
}

export function listSpecs(db: Db, query: ListSpecsQuery): ListSpecsResult {
  const filters = [
    query.status === null ? undefined : eq(schema.specs.status, query.status satisfies SpecState),
    query.mode === null ? undefined : eq(schema.specs.mode, query.mode satisfies SpecMode),
  ].filter((f): f is Exclude<typeof f, undefined> => f !== undefined);

  const where = filters.length === 0 ? undefined : and(...filters);

  const specs = db
    .select()
    .from(schema.specs)
    .where(where)
    .orderBy(desc(schema.specs.createdAt))
    .limit(query.limit)
    .offset(query.offset)
    .all();

  const total = db.select({ value: count() }).from(schema.specs).where(where).all()[0]?.value ?? 0;

  return { specs, total };
}
