import {
  type ArtifactKind,
  type SpecState,
  TransitionError,
  ValidationError,
} from '@agentforge/contract';
import { type Db, contentHashOf, schema, toJsonColumn } from '@agentforge/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { headArtifact } from './guards.ts';
import { newId } from './ids.ts';
import { runLogger } from './logger.ts';
import { requireSpec } from './transition.ts';
import type { Actor, ArtifactRow } from './types.ts';

/**
 * Versioned artifact writes.
 *
 * Artifacts are append-only: a change is a new version, never an edit, enforced by the
 * `artifact_versions_immutable` database trigger. That immutability is what makes a
 * content hash a durable thing to bind an approval to.
 */

/**
 * The state a spec must be in for each artifact kind to be written.
 *
 * Without this, an agent could post a `design` artifact while the spec is still in
 * requirements drafting and then transition straight past the requirements gate. The
 * transition table alone does not close that hole; this does.
 */
export const ALLOWED_WRITE_STATES: Record<ArtifactKind, readonly SpecState[]> = {
  context: ['CONTEXT_SCANNING'],
  requirements: ['REQ_DRAFTING'],
  design: ['DESIGN_DRAFTING'],
  tasks: ['DESIGN_APPROVED'],
};

export interface WriteArtifactInput {
  readonly specId: string;
  readonly kind: ArtifactKind;
  /**
   * The proposal, already validated against its schema by the caller. Hashed
   * canonically, so key order has no effect on the resulting hash.
   */
  readonly payload: unknown;
  /** Markdown rendered deterministically from `payload`. Never model-authored prose. */
  readonly contentMd: string;
  readonly actor: Actor;
  /**
   * Idempotency key for the agent call that produced this. A retry of the same logical
   * call returns the existing version instead of creating a duplicate — the hazard the
   * source document flags for framework resume semantics, avoided here by design.
   */
  readonly idempotencyKey?: string | null;
  readonly correlationId?: string;
}

export interface WriteArtifactResult {
  readonly artifact: ArtifactRow;
  /** True when an existing version was returned for a replayed idempotency key. */
  readonly replayed: boolean;
}

export function writeArtifact(db: Db, input: WriteArtifactInput): WriteArtifactResult {
  if (input.contentMd.length === 0) {
    throw new ValidationError('contentMd must not be empty', {
      spec_id: input.specId,
      kind: input.kind,
    });
  }

  const contentHash = contentHashOf(input.payload);
  const idempotencyKey = input.idempotencyKey ?? null;

  return db.transaction(
    (tx): WriteArtifactResult => {
      const spec = requireSpec(tx, input.specId);

      const allowed = ALLOWED_WRITE_STATES[input.kind];
      if (!allowed.includes(spec.status)) {
        throw new TransitionError(
          'PRECONDITION_FAILED',
          `a ${input.kind} artifact may only be written while the spec is in ` +
            `${allowed.join(' or ')}; it is in ${spec.status}`,
          {
            spec_id: spec.id,
            kind: input.kind,
            actual_state: spec.status,
            allowed_states: allowed,
          },
        );
      }

      if (idempotencyKey !== null) {
        const existing = tx
          .select()
          .from(schema.artifactVersions)
          .where(
            and(
              eq(schema.artifactVersions.specId, input.specId),
              eq(schema.artifactVersions.kind, input.kind),
              eq(schema.artifactVersions.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1)
          .all()[0];

        if (existing !== undefined) {
          runLogger(input.correlationId ?? 'no-correlation', { spec_id: spec.id }).info(
            { kind: input.kind, version: existing.version, idempotency_key: idempotencyKey },
            'artifact write replayed; returning existing version',
          );
          return { artifact: existing, replayed: true };
        }
      }

      const head = headArtifact(tx, input.specId, input.kind);
      const version = (head?.version ?? 0) + 1;

      const row: ArtifactRow = {
        id: newId('art'),
        specId: input.specId,
        kind: input.kind,
        version,
        contentJson: toJsonColumn(input.payload),
        contentMd: input.contentMd,
        contentHash,
        idempotencyKey,
        createdBy: input.actor.id,
        createdAt: new Date().toISOString(),
      };

      tx.insert(schema.artifactVersions).values(row).run();

      return { artifact: row, replayed: false };
    },
    { behavior: 'immediate' },
  );
}

/**
 * The artifact a previous call with this idempotency key produced, if any.
 *
 * Checked by an agent *before* its state guard: a call that already succeeded must be
 * replayable even though the spec has since advanced past the drafting state. Without
 * this, a client timeout and retry would surface as a precondition failure on work that
 * actually completed.
 */
export function findArtifactByIdempotencyKey(
  db: Db,
  specId: string,
  kind: ArtifactKind,
  idempotencyKey: string,
): ArtifactRow | undefined {
  return db
    .select()
    .from(schema.artifactVersions)
    .where(
      and(
        eq(schema.artifactVersions.specId, specId),
        eq(schema.artifactVersions.kind, kind),
        eq(schema.artifactVersions.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
    .all()[0];
}

/** The head version of a kind, or `undefined`. Read-only; safe outside a transaction. */
export function getHeadArtifact(
  db: Db,
  specId: string,
  kind: ArtifactKind,
): ArtifactRow | undefined {
  return db
    .select()
    .from(schema.artifactVersions)
    .where(and(eq(schema.artifactVersions.specId, specId), eq(schema.artifactVersions.kind, kind)))
    .orderBy(desc(schema.artifactVersions.version))
    .limit(1)
    .all()[0];
}

/** One specific version, or `undefined`. */
export function getArtifactVersion(
  db: Db,
  specId: string,
  kind: ArtifactKind,
  version: number,
): ArtifactRow | undefined {
  return db
    .select()
    .from(schema.artifactVersions)
    .where(
      and(
        eq(schema.artifactVersions.specId, specId),
        eq(schema.artifactVersions.kind, kind),
        eq(schema.artifactVersions.version, version),
      ),
    )
    .limit(1)
    .all()[0];
}

/** Every version of a kind, oldest first, for the version picker and diffs. */
export function listArtifactVersions(
  db: Db,
  specId: string,
  kind: ArtifactKind,
): readonly ArtifactRow[] {
  return db
    .select()
    .from(schema.artifactVersions)
    .where(and(eq(schema.artifactVersions.specId, specId), eq(schema.artifactVersions.kind, kind)))
    .orderBy(asc(schema.artifactVersions.version))
    .all();
}

/** The head version of every kind that exists for a spec, newest kind-version first. */
export function listHeadArtifacts(db: Db, specId: string): readonly ArtifactRow[] {
  const all = db
    .select()
    .from(schema.artifactVersions)
    .where(eq(schema.artifactVersions.specId, specId))
    .orderBy(desc(schema.artifactVersions.version))
    .all();

  const heads = new Map<ArtifactKind, ArtifactRow>();
  for (const row of all) {
    const current = heads.get(row.kind);
    if (current === undefined || row.version > current.version) {
      heads.set(row.kind, row);
    }
  }
  return [...heads.values()];
}
