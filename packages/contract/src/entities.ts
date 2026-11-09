import { z } from 'zod';
import { ComplianceRuleKeySchema, EntityIdSchema, TaskIdSchema } from './ids.ts';
import { SourceRefSchema } from './evidence.ts';
import {
  ACTOR_TYPES,
  APPROVAL_DECISIONS,
  ARTIFACT_KINDS,
  LLM_STAGES,
  SPEC_MODES,
  SPEC_STATES,
  TASK_STATUSES,
} from './states.ts';

/**
 * Entity shapes as the API returns them.
 *
 * These mirror the database tables but are not the same thing: snake_case is kept so
 * the wire format matches the SQL columns a reviewer will inspect by hand during the
 * demo, and JSON columns are returned already parsed and validated.
 */

export const SpecSchema = z.strictObject({
  id: EntityIdSchema,
  title: z.string().min(1).max(300),
  /** The feature request in the requester's own words. Hindi/Hinglish is accepted. */
  description: z.string().min(1).max(20000),
  mode: z.enum(SPEC_MODES),
  /**
   * Absolute path to the repository under analysis. Null for greenfield specs.
   * Every file tool is confined to this root; see the context-agent path guard.
   */
  repo_path: z.string().max(4096).nullable(),
  status: z.enum(SPEC_STATES),
  /**
   * Optimistic-lock counter, bumped by every successful transition. Clients echo the
   * value they last read so a stale tab cannot drive the state machine backwards.
   */
  version: z.number().int().nonnegative(),
  created_by: z.string().min(1).max(200),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type Spec = z.infer<typeof SpecSchema>;

export const ArtifactVersionSchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema,
  kind: z.enum(ARTIFACT_KINDS),
  /** 1-based, monotonic per (spec, kind). */
  version: z.number().int().positive(),
  /** The validated proposal JSON. Shape depends on `kind`. */
  content_json: z.unknown(),
  /** Markdown rendered deterministically from `content_json`. Never model-authored. */
  content_md: z.string(),
  /**
   * SHA-256 over the canonical JSON. Approvals bind to this value, so editing an
   * artifact after approval invalidates the approval rather than silently inheriting it.
   */
  content_hash: z.string().regex(/^[0-9a-f]{64}$/, 'content hash must be lowercase SHA-256 hex'),
  created_by: z.string().min(1).max(200),
  created_at: z.iso.datetime(),
});

export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const ApprovalSchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema,
  artifact_kind: z.enum(ARTIFACT_KINDS),
  artifact_version_id: EntityIdSchema,
  /** Copied at decision time so a later artifact edit cannot retro-fit this approval. */
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(APPROVAL_DECISIONS),
  comment: z.string().max(10000).nullable(),
  actor: z.string().min(1).max(200),
  created_at: z.iso.datetime(),
});

export type Approval = z.infer<typeof ApprovalSchema>;

export const ClarificationSchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema,
  /** 1-based clarification round. Capped at 2 rounds by the Requirement Agent. */
  round: z.number().int().positive(),
  question: z.string().min(1).max(1000),
  why_it_matters: z.string().min(1).max(1000),
  options: z.array(z.string().min(1).max(500)),
  answer: z.string().max(10000).nullable(),
  answered_by: z.string().max(200).nullable(),
  answered_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});

export type Clarification = z.infer<typeof ClarificationSchema>;

/**
 * One append-only audit entry.
 *
 * Nothing in the system updates or deletes these rows. `from_state` is null only for
 * the synthetic creation entry.
 */
export const AuditEntrySchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema,
  from_state: z.enum(SPEC_STATES).nullable(),
  to_state: z.enum(SPEC_STATES),
  actor: z.string().min(1).max(200),
  actor_type: z.enum(ACTOR_TYPES),
  reason: z.string().max(2000).nullable(),
  /** Structured detail: the artifact hash approved, the budget that tripped, etc. */
  payload: z.unknown(),
  /** Ties every entry to the run that caused it, so a run is reconstructable. */
  correlation_id: z.string().min(1).max(64),
  created_at: z.iso.datetime(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const TaskRowSchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema,
  /** The `TASK-00n` key from tasks.md. Unique per spec. */
  task_key: TaskIdSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
  status: z.enum(TASK_STATUSES),
  requirement_ids: z.array(z.string()),
  design_section_ids: z.array(z.string()),
  /** Acceptance criteria this task must make pass. */
  verifies: z.array(z.string()),
  /** Task keys that must complete before this one may start. */
  depends_on: z.array(TaskIdSchema),
  source_refs: z.array(SourceRefSchema),
  /** Evidence of completion supplied by the implementing agent via MCP. */
  completion_evidence: z.string().max(10000).nullable(),
  started_at: z.iso.datetime().nullable(),
  completed_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});

export type TaskRow = z.infer<typeof TaskRowSchema>;

/**
 * One Claude API call, recorded for cost accounting.
 *
 * The cache fields are not optional bookkeeping: the claim that prompt caching cuts
 * the context step by ~90% is only credible if measured, and these columns are the
 * measurement.
 */
export const LlmCallSchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema.nullable(),
  stage: z.enum(LLM_STAGES),
  model: z.string().min(1).max(100),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  /** True when served from the offline cassette rather than the live API. */
  from_cassette: z.boolean(),
  correlation_id: z.string().min(1).max(64),
  created_at: z.iso.datetime(),
});

export type LlmCall = z.infer<typeof LlmCallSchema>;

/** Rolled-up spend for one spec, with the configured ceiling for context. */
export const CostSummarySchema = z.strictObject({
  spec_id: EntityIdSchema,
  total_cost_usd: z.number().nonnegative(),
  cap_usd: z.number().positive(),
  call_count: z.number().int().nonnegative(),
  total_input_tokens: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  total_cache_read_tokens: z.number().int().nonnegative(),
  total_cache_creation_tokens: z.number().int().nonnegative(),
  /** Share of input tokens served from cache. The caching-works metric. */
  cache_hit_rate: z.number().min(0).max(1),
  by_stage: z.array(
    z.strictObject({
      stage: z.enum(LLM_STAGES),
      cost_usd: z.number().nonnegative(),
      call_count: z.number().int().nonnegative(),
    }),
  ),
});

export type CostSummary = z.infer<typeof CostSummarySchema>;

/** A per-module summary produced once per repo and cached on the module's git hash. */
export const RepoModuleSchema = z.strictObject({
  id: EntityIdSchema,
  spec_id: EntityIdSchema,
  module_path: z.string().min(1).max(1024),
  /** Tree hash of the module directory. Regeneration is skipped when unchanged. */
  git_hash: z.string().min(1).max(64),
  summary_md: z.string(),
  /** Primary authors from `git log`, most commits first. */
  owners: z.array(z.string().max(200)),
  generated_at: z.iso.datetime(),
});

export type RepoModule = z.infer<typeof RepoModuleSchema>;

/** A compliance rule as stored, carrying the pack version it arrived with. */
export const StoredComplianceRuleSchema = z.strictObject({
  pack_version: z.string(),
  rule_key: ComplianceRuleKeySchema,
  rule_json: z.unknown(),
});

export type StoredComplianceRule = z.infer<typeof StoredComplianceRuleSchema>;
