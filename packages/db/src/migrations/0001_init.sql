-- AgentForge initial schema.
--
-- Hand-written rather than generated, for three reasons:
--   1. FTS5 virtual tables and triggers are not expressible in a Drizzle schema;
--   2. the append-only guarantee on audit_log and approvals is enforced by triggers,
--      which is the difference between "we log transitions" and "transitions cannot be
--      rewritten" -- the governance claim rests on the latter;
--   3. CHECK constraints give defence in depth behind Zod, so a bug that bypasses
--      validation still cannot write a nonsense state.
--
-- The CHECK lists below are asserted against the TypeScript contract arrays by
-- packages/db/test/drift.test.ts, so the two cannot diverge silently.

-- ---------------------------------------------------------------------------
-- specs
-- ---------------------------------------------------------------------------

CREATE TABLE specs (
  id            TEXT    PRIMARY KEY,
  title         TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  description   TEXT    NOT NULL CHECK (length(description) BETWEEN 1 AND 20000),
  mode          TEXT    NOT NULL CHECK (mode IN ('greenfield', 'brownfield')),
  repo_path     TEXT,
  status        TEXT    NOT NULL CHECK (status IN (
                  'CREATED',
                  'CONTEXT_SCANNING', 'CONTEXT_READY',
                  'REQ_DRAFTING', 'REQ_AWAITING_CLARIFICATION',
                  'REQ_AWAITING_APPROVAL', 'REQ_APPROVED',
                  'DESIGN_DRAFTING', 'DESIGN_AWAITING_APPROVAL', 'DESIGN_APPROVED',
                  'TASKS_GENERATED', 'READY_FOR_IMPLEMENTATION', 'IMPLEMENTING',
                  'DONE', 'FAILED'
                )),
  -- Optimistic-lock counter. Bumped by every successful transition.
  version       INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,

  -- A brownfield spec needs a repo to analyse; a greenfield spec must not claim one.
  CHECK (
    (mode = 'brownfield' AND repo_path IS NOT NULL) OR
    (mode = 'greenfield' AND repo_path IS NULL)
  )
);

CREATE INDEX idx_specs_status ON specs (status);
CREATE INDEX idx_specs_created_at ON specs (created_at DESC);

-- ---------------------------------------------------------------------------
-- artifact_versions
-- ---------------------------------------------------------------------------

CREATE TABLE artifact_versions (
  id            TEXT    PRIMARY KEY,
  spec_id       TEXT    NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL CHECK (kind IN ('context', 'requirements', 'design', 'tasks')),
  version       INTEGER NOT NULL CHECK (version >= 1),
  content_json  TEXT    NOT NULL,
  content_md    TEXT    NOT NULL,
  -- SHA-256 over the canonical JSON. Approvals bind to this value.
  content_hash  TEXT    NOT NULL CHECK (length(content_hash) = 64),
  -- Set when produced by an idempotent agent call; a retry reuses the row.
  idempotency_key TEXT,
  created_by    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);

CREATE UNIQUE INDEX uq_artifact_versions_spec_kind_version
  ON artifact_versions (spec_id, kind, version);

CREATE INDEX idx_artifact_versions_lookup ON artifact_versions (spec_id, kind, version DESC);
-- Makes the idempotency check a point lookup, and stops two concurrent retries of the
-- same logical call from both inserting.
CREATE UNIQUE INDEX idx_artifact_versions_idem
  ON artifact_versions (spec_id, kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Artifact versions are immutable once written: a change is a new version, never an
-- edit, otherwise an approved content_hash could be made to describe different bytes.
CREATE TRIGGER artifact_versions_immutable
BEFORE UPDATE ON artifact_versions
BEGIN
  SELECT RAISE(ABORT, 'artifact_versions is immutable; write a new version instead');
END;

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------

CREATE TABLE approvals (
  id                  TEXT PRIMARY KEY,
  spec_id             TEXT NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  artifact_kind       TEXT NOT NULL CHECK (artifact_kind IN ('context', 'requirements', 'design', 'tasks')),
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  -- Copied at decision time. If the artifact is superseded, this hash no longer
  -- matches the head version and the approval stops counting -- by construction.
  content_hash        TEXT NOT NULL CHECK (length(content_hash) = 64),
  decision            TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes')),
  comment             TEXT,
  actor               TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_approvals_lookup ON approvals (spec_id, artifact_kind, created_at DESC);

-- A decision is a historical fact.
CREATE TRIGGER approvals_no_update
BEFORE UPDATE ON approvals
BEGIN
  SELECT RAISE(ABORT, 'approvals are append-only');
END;

CREATE TRIGGER approvals_no_delete
BEFORE DELETE ON approvals
BEGIN
  SELECT RAISE(ABORT, 'approvals are append-only');
END;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id             TEXT    PRIMARY KEY,
  spec_id        TEXT    NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  -- NULL only for the synthetic creation entry.
  from_state     TEXT,
  to_state       TEXT    NOT NULL,
  actor          TEXT    NOT NULL,
  actor_type     TEXT    NOT NULL CHECK (actor_type IN ('human', 'agent', 'orchestrator', 'system')),
  reason         TEXT,
  payload        TEXT    NOT NULL DEFAULT 'null',
  correlation_id TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  -- Monotonic sequence, so entries written inside one millisecond still order.
  seq            INTEGER NOT NULL
);

CREATE INDEX idx_audit_log_spec ON audit_log (spec_id, seq);
CREATE INDEX idx_audit_log_correlation ON audit_log (correlation_id);

-- The audit log is the record of state. Nothing may rewrite history.
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- ---------------------------------------------------------------------------
-- clarifications
-- ---------------------------------------------------------------------------

CREATE TABLE clarifications (
  id             TEXT    PRIMARY KEY,
  spec_id        TEXT    NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  round          INTEGER NOT NULL CHECK (round >= 1),
  question       TEXT    NOT NULL,
  why_it_matters TEXT    NOT NULL,
  options        TEXT    NOT NULL DEFAULT '[]',
  answer         TEXT,
  answered_by    TEXT,
  answered_at    TEXT,
  created_at     TEXT    NOT NULL,

  -- An answer, its author and its timestamp arrive together or not at all.
  CHECK (
    (answer IS NULL     AND answered_by IS NULL     AND answered_at IS NULL) OR
    (answer IS NOT NULL AND answered_by IS NOT NULL AND answered_at IS NOT NULL)
  )
);

CREATE INDEX idx_clarifications_spec ON clarifications (spec_id, round, created_at);

-- ---------------------------------------------------------------------------
-- context_evidence
-- ---------------------------------------------------------------------------

CREATE TABLE context_evidence (
  id             TEXT    PRIMARY KEY,
  spec_id        TEXT    NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  -- EV-001 style key, unique within a spec.
  evidence_key   TEXT    NOT NULL,
  file           TEXT    NOT NULL,
  line_start     INTEGER NOT NULL CHECK (line_start >= 1),
  line_end       INTEGER NOT NULL CHECK (line_end >= line_start),
  symbol         TEXT,
  claim          TEXT    NOT NULL,
  relevance      TEXT    NOT NULL,
  verified       INTEGER NOT NULL CHECK (verified IN (0, 1)),
  failure_reason TEXT    CHECK (failure_reason IS NULL OR failure_reason IN (
                   'file_not_found', 'not_a_file', 'path_escapes_repo',
                   'line_range_invalid', 'line_range_past_eof',
                   'symbol_not_in_range', 'file_unreadable'
                 )),
  created_at     TEXT    NOT NULL,

  -- Verified evidence has no failure reason; unverified evidence must give one.
  CHECK (
    (verified = 1 AND failure_reason IS NULL) OR
    (verified = 0 AND failure_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_context_evidence_spec_key ON context_evidence (spec_id, evidence_key);
CREATE INDEX idx_context_evidence_spec ON context_evidence (spec_id, verified);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  spec_id             TEXT NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  task_key            TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
  requirement_ids     TEXT NOT NULL DEFAULT '[]',
  design_section_ids  TEXT NOT NULL DEFAULT '[]',
  -- Acceptance criteria this task must make pass: the last hop of the trace chain.
  verifies            TEXT NOT NULL DEFAULT '[]',
  -- Task keys that must complete first. Stored so next_task is a real dependency
  -- check rather than an inference from key ordering.
  depends_on          TEXT NOT NULL DEFAULT '[]',
  source_refs         TEXT NOT NULL DEFAULT '[]',
  completion_evidence TEXT,
  started_at          TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL,

  -- A completed task must say how it was completed; that evidence is what the MCP
  -- complete_task call records and what the demo inspects.
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completion_evidence IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  ),
  CHECK ((status = 'pending' AND started_at IS NULL) OR status <> 'pending')
);

CREATE UNIQUE INDEX uq_tasks_spec_key ON tasks (spec_id, task_key);
CREATE INDEX idx_tasks_spec ON tasks (spec_id, task_key);

-- ---------------------------------------------------------------------------
-- compliance
-- ---------------------------------------------------------------------------

CREATE TABLE compliance_rules (
  pack_version TEXT NOT NULL,
  rule_key     TEXT NOT NULL,
  domain       TEXT NOT NULL CHECK (domain IN ('GST', 'TDS')),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('IN')),
  severity     TEXT NOT NULL CHECK (severity IN ('blocking', 'warning', 'advisory')),
  rule_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL,

  PRIMARY KEY (pack_version, rule_key)
);

CREATE TABLE compliance_traces (
  id                      TEXT PRIMARY KEY,
  spec_id                 TEXT NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  pack_version            TEXT NOT NULL,
  rule_key                TEXT NOT NULL,
  requirement_id          TEXT,
  acceptance_criterion_id TEXT,
  design_section_id       TEXT,
  task_id                 TEXT,
  test_ref                TEXT,
  created_at              TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_compliance_traces
  ON compliance_traces (spec_id, rule_key, acceptance_criterion_id);

CREATE INDEX idx_compliance_traces_spec ON compliance_traces (spec_id, rule_key);

-- ---------------------------------------------------------------------------
-- llm_calls
-- ---------------------------------------------------------------------------

CREATE TABLE llm_calls (
  id                          TEXT    PRIMARY KEY,
  spec_id                     TEXT    REFERENCES specs (id) ON DELETE CASCADE,
  stage                       TEXT    NOT NULL CHECK (stage IN (
                                'context_scan', 'module_summary', 'context_loop',
                                'requirements', 'clarification', 'design', 'tasks',
                                'compliance', 'eval'
                              )),
  model                       TEXT    NOT NULL,
  input_tokens                INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens               INTEGER NOT NULL CHECK (output_tokens >= 0),
  cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_input_tokens >= 0),
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_creation_input_tokens >= 0),
  cost_usd                    REAL    NOT NULL CHECK (cost_usd >= 0),
  latency_ms                  INTEGER NOT NULL CHECK (latency_ms >= 0),
  from_cassette               INTEGER NOT NULL DEFAULT 0 CHECK (from_cassette IN (0, 1)),
  correlation_id              TEXT    NOT NULL,
  created_at                  TEXT    NOT NULL
);

CREATE INDEX idx_llm_calls_spec ON llm_calls (spec_id, created_at);
CREATE INDEX idx_llm_calls_stage ON llm_calls (stage);

-- ---------------------------------------------------------------------------
-- repo_modules
-- ---------------------------------------------------------------------------

CREATE TABLE repo_modules (
  id           TEXT PRIMARY KEY,
  spec_id      TEXT NOT NULL REFERENCES specs (id) ON DELETE CASCADE,
  module_path  TEXT NOT NULL,
  -- Tree hash of the module directory; regeneration is skipped when unchanged.
  git_hash     TEXT NOT NULL,
  summary_md   TEXT NOT NULL,
  owners       TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_repo_modules ON repo_modules (spec_id, module_path);

-- ---------------------------------------------------------------------------
-- code_index (FTS5)
-- ---------------------------------------------------------------------------

-- Lexical candidate generator for the Context Agent: strong on identifiers, names and
-- error strings, zero LLM tokens, and it ships inside SQLite so there is no index
-- service to run. `tokenchars` keeps _ and $ inside identifiers rather than splitting
-- them, which matters for code far more than for prose.
CREATE VIRTUAL TABLE code_index USING fts5 (
  spec_id UNINDEXED,
  path,
  symbol,
  kind UNINDEXED,
  snippet,
  tokenize = "unicode61 remove_diacritics 0 tokenchars '_$'"
);

-- ---------------------------------------------------------------------------
-- meta
-- ---------------------------------------------------------------------------

-- Note: schema_migrations is created and owned by the migration runner in
-- client.ts, not by a migration, so it is deliberately absent here.

-- Monotonic counter backing audit_log.seq. A single row, bumped inside the same
-- transaction as the audit insert.
CREATE TABLE audit_seq (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);

INSERT INTO audit_seq (id, value) VALUES (1, 0);
