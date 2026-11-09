import { z } from 'zod';
import { ARTIFACT_KINDS, APPROVAL_DECISIONS, SPEC_MODES, SPEC_STATES } from './states.ts';
import {
  ApprovalSchema,
  ArtifactVersionSchema,
  AuditEntrySchema,
  ClarificationSchema,
  CostSummarySchema,
  SpecSchema,
  TaskRowSchema,
} from './entities.ts';
import { ContextBundleSchema } from './evidence.ts';
import { ComplianceCoverageSchema, CompliancePackSchema } from './compliance.ts';
import { EntityIdSchema, TaskIdSchema } from './ids.ts';

/**
 * The frozen HTTP contract.
 *
 * This file is the boundary between the backend and the UI. The frontend imports the
 * response schemas and the generated client from here and nothing else, which is what
 * lets the two tracks proceed in parallel against seeded fixtures.
 *
 * Conventions:
 * - request bodies are `strictObject`, so an unexpected field is an error rather than
 *   a silently ignored typo;
 * - every mutating request carries `expected_version` for optimistic locking;
 * - every approval request carries `content_hash`, binding the decision to the exact
 *   bytes reviewed.
 */

// --------------------------------------------------------------------------
// Specs
// --------------------------------------------------------------------------

export const CreateSpecRequestSchema = z
  .strictObject({
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(20000),
    mode: z.enum(SPEC_MODES),
    /** Required for brownfield, forbidden for greenfield. Enforced by the refinement. */
    repo_path: z.string().min(1).max(4096).nullable(),
  })
  .refine((v) => (v.mode === 'brownfield' ? v.repo_path !== null : v.repo_path === null), {
    message: 'brownfield specs require repo_path; greenfield specs must not set it',
    path: ['repo_path'],
  });

export type CreateSpecRequest = z.infer<typeof CreateSpecRequestSchema>;

export const CreateSpecResponseSchema = z.strictObject({ spec: SpecSchema });

export const ListSpecsQuerySchema = z.strictObject({
  status: z.enum(SPEC_STATES).nullable(),
  mode: z.enum(SPEC_MODES).nullable(),
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0),
});

export type ListSpecsQuery = z.infer<typeof ListSpecsQuerySchema>;

export const ListSpecsResponseSchema = z.strictObject({
  specs: z.array(SpecSchema),
  total: z.number().int().nonnegative(),
});

/** A spec plus everything a detail screen needs, in one round trip. */
export const GetSpecResponseSchema = z.strictObject({
  spec: SpecSchema,
  /** Latest version of each artifact kind that exists, newest first. */
  artifacts: z.array(ArtifactVersionSchema),
  approvals: z.array(ApprovalSchema),
  open_clarifications: z.array(ClarificationSchema),
  /** Legal next states from here, so the UI never offers an action that would 409. */
  available_transitions: z.array(z.enum(SPEC_STATES)),
});

// --------------------------------------------------------------------------
// Context (brownfield)
// --------------------------------------------------------------------------

export const ScanContextRequestSchema = z.strictObject({
  expected_version: z.number().int().nonnegative(),
  /** Which retrieval strategy to run. Named so the eval harness can drive ablations. */
  strategy: z.enum(['grep', 'repomap', 'fts_repomap', 'fts_repomap_embed']),
  /** Overrides the env default. Still clamped to the hard ceiling server-side. */
  max_tool_calls: z.number().int().min(1).max(100).nullable(),
});

export type ScanContextRequest = z.infer<typeof ScanContextRequestSchema>;

export const ScanContextResponseSchema = z.strictObject({
  spec: SpecSchema,
  bundle: ContextBundleSchema,
});

export const GetContextResponseSchema = z.strictObject({
  bundle: ContextBundleSchema.nullable(),
});

// --------------------------------------------------------------------------
// Requirements, clarifications
// --------------------------------------------------------------------------

export const DraftRequirementsRequestSchema = z.strictObject({
  expected_version: z.number().int().nonnegative(),
  /**
   * Caller-supplied idempotency key. A retried draft reuses the existing artifact
   * version instead of creating a duplicate.
   */
  idempotency_key: z.string().min(8).max(128),
});

export type DraftRequirementsRequest = z.infer<typeof DraftRequirementsRequestSchema>;

export const DraftArtifactResponseSchema = z.strictObject({
  spec: SpecSchema,
  artifact: ArtifactVersionSchema.nullable(),
  /** Populated when the agent asked questions instead of producing requirements. */
  clarifications: z.array(ClarificationSchema),
});

export const ListClarificationsResponseSchema = z.strictObject({
  clarifications: z.array(ClarificationSchema),
});

export const AnswerClarificationsRequestSchema = z.strictObject({
  expected_version: z.number().int().nonnegative(),
  answers: z
    .array(
      z.strictObject({
        clarification_id: EntityIdSchema,
        answer: z.string().min(1).max(10000),
      }),
    )
    .min(1)
    .max(20),
});

export type AnswerClarificationsRequest = z.infer<typeof AnswerClarificationsRequestSchema>;

// --------------------------------------------------------------------------
// Artifacts, approvals
// --------------------------------------------------------------------------

export const GetArtifactQuerySchema = z.strictObject({
  version: z.coerce.number().int().positive().nullable(),
});

export const GetArtifactResponseSchema = z.strictObject({
  artifact: ArtifactVersionSchema,
  /** Every version of this kind, oldest first, for the version picker. */
  history: z.array(
    z.strictObject({
      id: EntityIdSchema,
      version: z.number().int().positive(),
      content_hash: z.string(),
      created_at: z.iso.datetime(),
      created_by: z.string(),
    }),
  ),
});

export const DiffArtifactQuerySchema = z.strictObject({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

/** A unified-diff hunk over the rendered markdown, computed server-side. */
export const DiffArtifactResponseSchema = z.strictObject({
  kind: z.enum(ARTIFACT_KINDS),
  from_version: z.number().int().positive(),
  to_version: z.number().int().positive(),
  hunks: z.array(
    z.strictObject({
      from_start: z.number().int().nonnegative(),
      from_lines: z.number().int().nonnegative(),
      to_start: z.number().int().nonnegative(),
      to_lines: z.number().int().nonnegative(),
      lines: z.array(
        z.strictObject({
          op: z.enum(['context', 'add', 'remove']),
          text: z.string(),
        }),
      ),
    }),
  ),
});

/**
 * An approval decision.
 *
 * `content_hash` is mandatory and checked against the artifact version being
 * approved. This is the mechanism behind the governance claim: a reviewer can only
 * approve the bytes they actually saw.
 */
export const DecideArtifactRequestSchema = z.strictObject({
  expected_version: z.number().int().nonnegative(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/, 'content_hash must be SHA-256 hex'),
  decision: z.enum(APPROVAL_DECISIONS),
  comment: z.string().max(10000).nullable(),
});

export type DecideArtifactRequest = z.infer<typeof DecideArtifactRequestSchema>;

export const DecideArtifactResponseSchema = z.strictObject({
  spec: SpecSchema,
  approval: ApprovalSchema,
});

// --------------------------------------------------------------------------
// Audit, cost, tasks, compliance
// --------------------------------------------------------------------------

export const GetAuditResponseSchema = z.strictObject({
  entries: z.array(AuditEntrySchema),
});

export const GetCostResponseSchema = z.strictObject({
  cost: CostSummarySchema,
});

export const ListTasksResponseSchema = z.strictObject({
  tasks: z.array(TaskRowSchema),
});

export const GetCompliancePackResponseSchema = z.strictObject({
  pack: CompliancePackSchema,
});

export const GetComplianceTraceResponseSchema = z.strictObject({
  coverage: ComplianceCoverageSchema,
});

// --------------------------------------------------------------------------
// Implementation hand-off (used by the MCP server)
// --------------------------------------------------------------------------

export const StartTaskRequestSchema = z.strictObject({
  task_key: TaskIdSchema,
  expected_version: z.number().int().nonnegative(),
});

export const CompleteTaskRequestSchema = z.strictObject({
  task_key: TaskIdSchema,
  expected_version: z.number().int().nonnegative(),
  /** What the implementing agent changed, and how it verified the change. */
  evidence: z.string().min(1).max(10000),
});

// --------------------------------------------------------------------------
// Server-sent events
// --------------------------------------------------------------------------

/**
 * Events streamed while an agent works.
 *
 * The UI shows drafts as they arrive; `done` and `error` are terminal. Streaming is
 * purely a UX affordance and costs nothing extra — batching is the only cost lever.
 */
export const StreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('state'), state: z.enum(SPEC_STATES) }),
  z.strictObject({ type: z.literal('token'), text: z.string() }),
  z.strictObject({
    type: z.literal('tool_call'),
    name: z.string(),
    /** 1-based index against the configured ceiling, so the UI can show a budget bar. */
    index: z.number().int().positive(),
    budget: z.number().int().positive(),
  }),
  z.strictObject({ type: z.literal('cost'), cost_usd: z.number().nonnegative() }),
  z.strictObject({ type: z.literal('done'), artifact_id: EntityIdSchema.nullable() }),
  z.strictObject({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

// --------------------------------------------------------------------------
// Route manifest
// --------------------------------------------------------------------------

/**
 * Every route, its method, and its schemas.
 *
 * The CI contract-conformance check walks this manifest, so a route added without a
 * schema, or a schema added without a route, fails the build rather than drifting.
 */
export const ROUTES = {
  createSpec: { method: 'POST', path: '/api/specs' },
  listSpecs: { method: 'GET', path: '/api/specs' },
  getSpec: { method: 'GET', path: '/api/specs/:id' },
  scanContext: { method: 'POST', path: '/api/specs/:id/context/scan' },
  getContext: { method: 'GET', path: '/api/specs/:id/context' },
  draftRequirements: { method: 'POST', path: '/api/specs/:id/requirements/draft' },
  listClarifications: { method: 'GET', path: '/api/specs/:id/clarifications' },
  answerClarifications: { method: 'POST', path: '/api/specs/:id/clarifications/answer' },
  draftDesign: { method: 'POST', path: '/api/specs/:id/design/draft' },
  generateTasks: { method: 'POST', path: '/api/specs/:id/tasks/generate' },
  getArtifact: { method: 'GET', path: '/api/specs/:id/artifacts/:kind' },
  diffArtifact: { method: 'GET', path: '/api/specs/:id/artifacts/:kind/diff' },
  decideArtifact: { method: 'POST', path: '/api/specs/:id/artifacts/:kind/decide' },
  getAudit: { method: 'GET', path: '/api/specs/:id/audit' },
  getCost: { method: 'GET', path: '/api/specs/:id/cost' },
  listTasks: { method: 'GET', path: '/api/specs/:id/tasks' },
  getCompliancePack: { method: 'GET', path: '/api/compliance/pack' },
  getComplianceTrace: { method: 'GET', path: '/api/specs/:id/compliance/trace' },
  stream: { method: 'GET', path: '/api/specs/:id/stream' },
} as const satisfies Record<string, { method: 'GET' | 'POST'; path: string }>;

export type RouteName = keyof typeof ROUTES;
