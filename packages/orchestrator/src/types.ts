import type { ActorType } from '@agentforge/contract';
import type { Db, schema } from '@agentforge/db';

/**
 * Shared internal types.
 *
 * `Tx` is derived from Drizzle's own transaction callback rather than spelled out, so
 * it cannot drift from the driver's actual type as Drizzle evolves.
 */

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A `specs` row as Drizzle selects it. */
export type SpecRow = typeof schema.specs.$inferSelect;

/** An `artifact_versions` row as Drizzle selects it. */
export type ArtifactRow = typeof schema.artifactVersions.$inferSelect;

/**
 * Who is performing an action.
 *
 * Carried on every mutating orchestrator call and written to the audit log. The
 * `type` is what the transition table gates on: approval edges admit only `human`.
 */
export interface Actor {
  /** Identity: an email, a username, or an agent name such as `requirement-agent`. */
  readonly id: string;
  readonly type: ActorType;
}
