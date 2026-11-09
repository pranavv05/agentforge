import {
  type Approval,
  ApprovalSchema,
  type ArtifactVersion,
  ArtifactVersionSchema,
  type AuditEntry,
  AuditEntrySchema,
  type Spec,
  SpecSchema,
} from '@agentforge/contract';
import { parseJsonColumn } from '@agentforge/db';
import type { schema } from '@agentforge/db';
import { z } from 'zod';

/**
 * Row-to-wire mapping.
 *
 * Drizzle rows are camelCase with SQLite's TEXT-encoded JSON and 0/1 booleans; the
 * contract is snake_case with real types. Converting in one place, and validating the
 * result against the contract schema, means a column rename cannot leak to the UI as a
 * silently missing field — it fails here instead.
 */

export function presentSpec(row: typeof schema.specs.$inferSelect): Spec {
  return SpecSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    mode: row.mode,
    repo_path: row.repoPath,
    status: row.status,
    version: row.version,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });
}

export function presentArtifact(row: typeof schema.artifactVersions.$inferSelect): ArtifactVersion {
  return ArtifactVersionSchema.parse({
    id: row.id,
    spec_id: row.specId,
    kind: row.kind,
    version: row.version,
    // Validated as unknown at this layer: the payload's own schema is applied by
    // whichever consumer needs the typed shape.
    content_json: parseJsonColumn(
      z.unknown(),
      row.contentJson,
      `artifact_versions.content_json (${row.id})`,
    ),
    content_md: row.contentMd,
    content_hash: row.contentHash,
    created_by: row.createdBy,
    created_at: row.createdAt,
  });
}

export function presentApproval(row: typeof schema.approvals.$inferSelect): Approval {
  return ApprovalSchema.parse({
    id: row.id,
    spec_id: row.specId,
    artifact_kind: row.artifactKind,
    artifact_version_id: row.artifactVersionId,
    content_hash: row.contentHash,
    decision: row.decision,
    comment: row.comment,
    actor: row.actor,
    created_at: row.createdAt,
  });
}

export function presentAuditEntry(row: typeof schema.auditLog.$inferSelect): AuditEntry {
  return AuditEntrySchema.parse({
    id: row.id,
    spec_id: row.specId,
    from_state: row.fromState,
    to_state: row.toState,
    actor: row.actor,
    actor_type: row.actorType,
    reason: row.reason,
    payload: parseJsonColumn(z.unknown(), row.payload, `audit_log.payload (${row.id})`),
    correlation_id: row.correlationId,
    created_at: row.createdAt,
  });
}
