import {
  ACTOR_TYPES,
  APPROVAL_DECISIONS,
  ARTIFACT_KINDS,
  COMPLIANCE_DOMAINS,
  COMPLIANCE_SEVERITIES,
  GROUNDING_FAILURES,
  JURISDICTIONS,
  LLM_STAGES,
  SPEC_MODES,
  SPEC_STATES,
  TASK_STATUSES,
} from '@agentforge/contract';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Drizzle mirror of `migrations/0001_init.sql`.
 *
 * The SQL file is the source of truth for DDL — it carries the FTS5 table, the
 * append-only triggers and the CHECK constraints, none of which Drizzle can express.
 * This file exists so queries are type-checked against real column names.
 *
 * `packages/db/test/drift.test.ts` compares these declarations against the live
 * `sqlite_master` after migration, so the mirror cannot fall out of step.
 *
 * Enum lists are imported from the contract rather than retyped, so there is exactly
 * one place where a state name is spelled.
 */

const enumList = <T extends string>(values: readonly T[]): [T, ...T[]] => {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('enum list must not be empty');
  return [first, ...rest];
};

export const specs = sqliteTable(
  'specs',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    mode: text('mode', { enum: enumList(SPEC_MODES) }).notNull(),
    repoPath: text('repo_path'),
    status: text('status', { enum: enumList(SPEC_STATES) }).notNull(),
    version: integer('version').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_specs_status').on(t.status), index('idx_specs_created_at').on(t.createdAt)],
);

export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: enumList(ARTIFACT_KINDS) }).notNull(),
    version: integer('version').notNull(),
    contentJson: text('content_json').notNull(),
    contentMd: text('content_md').notNull(),
    contentHash: text('content_hash').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_artifact_versions_spec_kind_version').on(t.specId, t.kind, t.version),
    index('idx_artifact_versions_lookup').on(t.specId, t.kind, t.version),
    // Partial unique index: makes the idempotency check a point lookup and stops two
    // concurrent retries of the same logical agent call from both inserting.
    uniqueIndex('idx_artifact_versions_idem')
      .on(t.specId, t.kind, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  ],
);

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    artifactKind: text('artifact_kind', { enum: enumList(ARTIFACT_KINDS) }).notNull(),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    decision: text('decision', { enum: enumList(APPROVAL_DECISIONS) }).notNull(),
    comment: text('comment'),
    actor: text('actor').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_approvals_lookup').on(t.specId, t.artifactKind, t.createdAt)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    fromState: text('from_state', { enum: enumList(SPEC_STATES) }),
    toState: text('to_state', { enum: enumList(SPEC_STATES) }).notNull(),
    actor: text('actor').notNull(),
    actorType: text('actor_type', { enum: enumList(ACTOR_TYPES) }).notNull(),
    reason: text('reason'),
    payload: text('payload')
      .notNull()
      .default(sql`'null'`),
    correlationId: text('correlation_id').notNull(),
    createdAt: text('created_at').notNull(),
    seq: integer('seq').notNull(),
  },
  (t) => [
    index('idx_audit_log_spec').on(t.specId, t.seq),
    index('idx_audit_log_correlation').on(t.correlationId),
  ],
);

export const clarifications = sqliteTable(
  'clarifications',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    question: text('question').notNull(),
    whyItMatters: text('why_it_matters').notNull(),
    options: text('options')
      .notNull()
      .default(sql`'[]'`),
    answer: text('answer'),
    answeredBy: text('answered_by'),
    answeredAt: text('answered_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_clarifications_spec').on(t.specId, t.round, t.createdAt)],
);

export const contextEvidence = sqliteTable(
  'context_evidence',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    evidenceKey: text('evidence_key').notNull(),
    file: text('file').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
    symbol: text('symbol'),
    claim: text('claim').notNull(),
    relevance: text('relevance').notNull(),
    verified: integer('verified').notNull(),
    failureReason: text('failure_reason', { enum: enumList(GROUNDING_FAILURES) }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_context_evidence_spec_key').on(t.specId, t.evidenceKey),
    index('idx_context_evidence_spec').on(t.specId, t.verified),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    taskKey: text('task_key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status', { enum: enumList(TASK_STATUSES) }).notNull(),
    requirementIds: text('requirement_ids')
      .notNull()
      .default(sql`'[]'`),
    designSectionIds: text('design_section_ids')
      .notNull()
      .default(sql`'[]'`),
    verifies: text('verifies')
      .notNull()
      .default(sql`'[]'`),
    dependsOn: text('depends_on')
      .notNull()
      .default(sql`'[]'`),
    sourceRefs: text('source_refs')
      .notNull()
      .default(sql`'[]'`),
    completionEvidence: text('completion_evidence'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_tasks_spec_key').on(t.specId, t.taskKey),
    index('idx_tasks_spec').on(t.specId, t.taskKey),
  ],
);

export const complianceRules = sqliteTable(
  'compliance_rules',
  {
    packVersion: text('pack_version').notNull(),
    ruleKey: text('rule_key').notNull(),
    domain: text('domain', { enum: enumList(COMPLIANCE_DOMAINS) }).notNull(),
    jurisdiction: text('jurisdiction', { enum: enumList(JURISDICTIONS) }).notNull(),
    severity: text('severity', { enum: enumList(COMPLIANCE_SEVERITIES) }).notNull(),
    ruleJson: text('rule_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.packVersion, t.ruleKey] })],
);

export const complianceTraces = sqliteTable(
  'compliance_traces',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    packVersion: text('pack_version').notNull(),
    ruleKey: text('rule_key').notNull(),
    requirementId: text('requirement_id'),
    acceptanceCriterionId: text('acceptance_criterion_id'),
    designSectionId: text('design_section_id'),
    taskId: text('task_id'),
    testRef: text('test_ref'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_compliance_traces').on(t.specId, t.ruleKey, t.acceptanceCriterionId),
    index('idx_compliance_traces_spec').on(t.specId, t.ruleKey),
  ],
);

export const llmCalls = sqliteTable(
  'llm_calls',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id').references(() => specs.id, { onDelete: 'cascade' }),
    stage: text('stage', { enum: enumList(LLM_STAGES) }).notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadInputTokens: integer('cache_read_input_tokens').notNull().default(0),
    cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull(),
    costSource: text('cost_source', {
      enum: ['reported', 'computed', 'none'],
    })
      .notNull()
      .default('computed'),
    latencyMs: integer('latency_ms').notNull(),
    fromCassette: integer('from_cassette').notNull().default(0),
    correlationId: text('correlation_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_llm_calls_spec').on(t.specId, t.createdAt),
    index('idx_llm_calls_stage').on(t.stage),
  ],
);

export const repoModules = sqliteTable(
  'repo_modules',
  {
    id: text('id').primaryKey(),
    specId: text('spec_id')
      .notNull()
      .references(() => specs.id, { onDelete: 'cascade' }),
    modulePath: text('module_path').notNull(),
    gitHash: text('git_hash').notNull(),
    /** The checkout these summaries describe, so the cache is shared across specs. */
    repoPath: text('repo_path').notNull().default(''),
    summaryMd: text('summary_md').notNull(),
    owners: text('owners')
      .notNull()
      .default(sql`'[]'`),
    generatedAt: text('generated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_repo_modules').on(t.specId, t.modulePath)],
);

export const schemaMigrations = sqliteTable('schema_migrations', {
  name: text('name').primaryKey(),
  appliedAt: text('applied_at').notNull(),
  checksum: text('checksum').notNull(),
});

export const auditSeq = sqliteTable('audit_seq', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull().default(0),
});

/**
 * `code_index` is an FTS5 virtual table and is queried through raw SQL in the
 * context-agent package. It is listed here only so the drift test knows to expect it.
 */
export const VIRTUAL_TABLES = ['code_index'] as const;
