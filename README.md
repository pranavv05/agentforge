# AgentForge

An agentic, spec-driven development platform. Give it a feature request and a chain of
agents produces `requirements.md`, `design.md` and `tasks.md`, each held behind a human
approval gate. The approved tasks are then handed to Claude Code through an MCP server and
a plugin that only permits edits while the spec is in an approved state.

Many tools generate those three documents. AgentForge is built around three things the
generation step alone does not give you:

1. **Server-enforced governance.** Stage transitions belong to a deterministic
   orchestrator. Approvals bind to a content hash. The audit log is append-only at the
   database level. A Claude Code `PreToolUse` hook denies file edits outside an approved
   state.
2. **Evidence-checked brownfield specs.** Every claim an agent makes about existing code
   carries a `file:line` reference that deterministic code verifies. Failing claims are
   flagged before they reach a document, and the _unverified-claim rate_ is reported as a
   measurable hallucination metric.
3. **Compliance as acceptance criteria.** A versioned GST/TDS rule pack injects testable
   Given/When/Then criteria and traces each one rule → requirement → design → task → test.

---

## Contents

1. [Quick start](#quick-start)
2. [How a spec moves](#how-a-spec-moves)
3. [Architecture](#architecture)
4. [The three differentiators in detail](#the-three-differentiators-in-detail)
5. [The web application](#the-web-application)
6. [HTTP API](#http-api)
7. [Connecting Claude Code](#connecting-claude-code)
8. [Configuration](#configuration)
9. [Commands](#commands)
10. [The LLM layer](#the-llm-layer)
11. [Evaluation](#evaluation)
12. [Measured results](#measured-results)
13. [Testing](#testing)
14. [Engineering rules](#engineering-rules)
15. [Conventions](#conventions)

---

## Quick start

Requires Node 22 or newer (developed on Node 24) and git.

```bash
npm install            # also approves the better-sqlite3 and esbuild install scripts
cp .env.example .env   # then fill in a gateway key and BETTER_AUTH_SECRET
npm run db:migrate     # apply SQL migrations (idempotent, checksum-guarded)
npm run db:seed        # optional: three fixture specs at different lifecycle points
npm run dev            # http://localhost:3000
```

Either `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` works. Everything that does not call a
model (the test suite, `sdd:scan`, the deterministic `eval`) needs no key and costs nothing.

Sign up at `/sign-up`, open `/workspace`, describe a feature, and the three-gate flow
starts. A first-run screen explains the flow and offers example prompts.

---

## How a spec moves

```
CREATED ──► CONTEXT_SCANNING ──► CONTEXT_READY            (brownfield only)
   │                                   │
   └──────────────┬────────────────────┘
                  ▼
   REQ_DRAFTING ⇄ REQ_AWAITING_CLARIFICATION
        │
        ▼
   REQ_AWAITING_APPROVAL ──► REQ_APPROVED
        │                         │
        │ changes requested       ▼
        └─► REQ_DRAFTING    DESIGN_DRAFTING ──► DESIGN_AWAITING_APPROVAL ──► DESIGN_APPROVED
                                                       │ changes requested        │
                                                       └─► DESIGN_DRAFTING        ▼
                                                                          TASKS_GENERATED
                                                                                  │ approved
                                                                                  ▼
                                              READY_FOR_IMPLEMENTATION ──► IMPLEMENTING ──► DONE
                                                                       any state ──► FAILED
```

Fifteen states, defined once in `packages/contract/src/states.ts`. The transition table is
tested over all 225 ordered pairs: every legal edge works and every illegal one is refused.

- **Greenfield** specs skip the context stages.
- **Brownfield** specs point at a repository on disk (`repo_path`); the Context Agent scans
  it first, and requirements and design cite the verified evidence.
- Up to two clarification rounds happen in `REQ_AWAITING_CLARIFICATION`.
- Editing an artifact produces a **new immutable version with a new hash**, which
  invalidates the old approval. Design drafting refuses to start unless the approved
  requirements hash still matches the latest requirements version.
- Only a human can approve. Agents propose, humans decide, and the orchestrator moves the
  spec.

---

## Architecture

```
packages/
  contract/        Zod schemas, states, error taxonomy, HTTP contract. Frozen.
  db/              SQLite (better-sqlite3) + Drizzle mirror; hand-written SQL migrations.
  orchestrator/    The state machine. The only writer of specs.status.
  agents/          Requirement, Design and Task agents + deterministic markdown renderers.
  llm/             Anthropic wrapper: structured outputs, caching, cassettes, usage log.
  skills/          SKILL.md files: the single source of truth for every agent prompt.
  context-agent/   Context Agent stages 0-3 and the grounding verifier.
  compliance/      Rule pack, criteria injector, superseded-term detector, trace matrix.
  mcp-server/      MCP tools for the implementation phase.
  plugin/          Claude Code plugin: PreToolUse hook + /sdd-implement skill.
  eval/            Ground-truth miner, deterministic and agentic ablations, metrics.
apps/web/
  app/api/**       Backend routes.
  app/(marketing)  Landing page; server-rendered docs, product, compare, resources pages.
  app/(workspace)  The three-pane workspace (thread rail, thread, document pane).
  components/      site/ (marketing) and workspace/ (app).
  lib/             Route wrapper, row-to-wire mapping, diffing, auth, site helpers.
scripts/           seed, scan, smoke tests, eval CLIs.
```

`packages/contract` sits at the bottom of the dependency graph and imports nothing from the
other packages. The browser imports it too, so it stays free of `node:*` imports.

### Data model

SQLite, one file. Tables include: `specs` (with a `version` used for optimistic locking),
`audit_log` (append-only), `artifact_versions` (immutable; carries `content_hash`),
`approvals` (append-only; bound to an artifact version and hash), `clarifications`,
`context_evidence` (file, line range, symbol, claim, `verified`, `failure_reason`), `tasks`,
`compliance_rules`, `compliance_traces`, `llm_calls` (tokens, cache counters, cost,
`cost_source`, correlation id), `repo_modules` (module summaries cached by git hash) and
`code_index` (an FTS5 virtual table). Better Auth keeps its own user and session tables.

### Error taxonomy

Every API failure carries a code from one list: `VALIDATION_FAILED`, `UNAUTHENTICATED`,
`ILLEGAL_TRANSITION`, `VERSION_CONFLICT`, `HASH_MISMATCH`, `PRECONDITION_FAILED`,
`GROUNDING_FAILED`, `BUDGET_EXCEEDED`, `BUDGET_LIMIT_REACHED`, `COMPLIANCE_VIOLATION`,
`UPSTREAM_FAILED`, `PATH_ESCAPES_ROOT`, `NOT_FOUND`, `INTERNAL`. The UI branches on the
code, not on message text, and every error response includes a correlation id.

---

## The three differentiators in detail

### 1. Server-enforced governance

- **One writer.** `transition(specId, from, to, actor, expectedVersion)` is the only code
  that writes `specs.status`. It runs in a single transaction, checks the version, appends
  to the audit log, and applies guards (for example the requirements hash must still match
  before design drafting).
- **Approvals bind to bytes.** An approval records the artifact version id and its content
  hash. A stale hash returns `409 HASH_MISMATCH` with no state change and no audit row.
- **History cannot be rewritten.** Database triggers refuse any `UPDATE` on the audit log
  and approvals, and refuse `DELETE` while the parent spec exists. Direct SQL hits the same
  triggers.
- **Edit gate in Claude Code.** The plugin's `PreToolUse` hook governs sessions pinned to a
  spec (via `SDD_SPEC_ID` or `.sdd/current-spec`). It refuses Edit, Write, NotebookEdit and
  MultiEdit unless the spec is in `READY_FOR_IMPLEMENTATION` or `IMPLEMENTING` **and** a
  task is claimed. It reads SQLite directly, answers in milliseconds, and fails closed on
  any internal error. It is tested as a real subprocess in all eight pre-release states.

### 2. Evidence-checked brownfield specs

The Context Agent works in four stages:

- **Stage 0 (no model).** File inventory from `git ls-files` (with a `.gitignore`-aware
  fallback for non-checkouts), manifest parsing (`package.json`, `requirements.txt`,
  `pyproject.toml`, `pom.xml`), a tree-sitter definitions-and-references graph ranked into a
  compact repo map, and an FTS5 index over paths, symbols and comments.
- **Stage 1.** One cached summary per top-level module, keyed on the module's git hash and
  scoped to the repository, so a second feature against the same checkout reuses the first
  one's work.
- **Stage 2.** A budgeted agentic loop (default 25 tool calls, prompt kept under 100K
  tokens) with tools `repo_map`, `fts_search`, `grep`, `read_file` and `list_dir`, all
  confined to the repository root.
- **Stage 3, the grounding verifier.** Deterministic code checks that each cited path
  exists inside the repo, the line range is valid, and the named symbol really appears in
  that range. Failures are kept (not discarded) so the **unverified-claim rate** has a real
  denominator.

Retrieval strategies, selectable per scan: `grep`, `repomap`, `fts`, `fts_repomap`. Each
exposes a different tool set to the model.

Repository content is treated as data. A `CLAUDE.md` or comment inside a scanned repo has no
authority; it is fenced in prompts and cannot change the verifier's verdict.

### 3. Compliance as acceptance criteria

- A **versioned rule pack** (v1.0.0, 15 rules) covers GST e-invoice mandatory fields and TDS
  under the Income-tax Act 2025 Section 393. Rules carry citations; where sources disagree,
  the disagreement is recorded in the rule's `source_conflict_note`.
- The **injector** adds Given/When/Then acceptance criteria to matching requirements.
- The **superseded-term detector** blocks a design that cites a dissolved provision as
  current law (for example a deduction "under Section 194J") and names the replacement
  (Section 393). A sentence that mentions the old section only to reject it, or that names
  Section 393, is accepted and reported as `advisory`.
- The **trace matrix** links rule → requirement → design section → task → test, and reports
  coverage.
- The pack is installed automatically at server start and wherever it is consumed
  (`ensurePackInstalled`).

---

## The web application

Next.js 16 and React 19, with Better Auth for sessions (the audit log's actor attribution
rests on them).

- **Marketing site** (`/`, `/product/*`, `/compare/*`, `/resources/*`, `/docs/*`,
  `/sign-in`, `/sign-up`): a server-rendered port of the frontend track's design, reading the
  real compliance pack and transition table. Docs are written against the real routes.
- **Workspace** (`/workspace`): a three-pane layout. The thread rail lists specs; the thread
  shows the conversation with the agents; the document pane shows requirements, design,
  tasks, the context bundle, the audit timeline, the diff between versions, and the
  compliance trace.
- **Decisions.** Approve, reject or request changes with a comment; the decision binds to the
  hash on screen.
- **Live runs.** The footer follows a running agent over SSE with elapsed time and this run's
  spend, and refreshes the thread when the state changes.
- **Errors.** One function, `explainError`, branches on the error code and says what
  happened, whether anything changed, and what to do.
- **Themes and layout.** Light with a dark toggle. Below 54rem the rail becomes a drawer and
  the document becomes a sheet, with 44px touch targets.
- **Accessibility.** Audited with axe-core in a real browser in both themes; the workspace
  and the auth, docs and compare pages finish with zero violations.

---

## HTTP API

All routes require a signed-in user except `/api/public/*` and `/api/auth/*`. Request bodies
are strict Zod objects; mutating requests carry `expected_version`, and approvals carry
`content_hash`.

| Route                                        | Purpose                                |
| -------------------------------------------- | -------------------------------------- |
| `GET/POST /api/specs`                        | list and create specs                  |
| `GET /api/specs/:id`                         | one spec                               |
| `POST /api/specs/:id/context/scan`           | run the Context Agent (brownfield)     |
| `GET /api/specs/:id/context`                 | the verified context bundle            |
| `POST /api/specs/:id/requirements/draft`     | Requirement Agent                      |
| `GET /api/specs/:id/clarifications`          | open questions                         |
| `POST /api/specs/:id/clarifications/answer`  | answer them                            |
| `POST /api/specs/:id/design/draft`           | Design Agent                           |
| `POST /api/specs/:id/tasks/generate`         | Task Agent                             |
| `GET /api/specs/:id/tasks`                   | task rows                              |
| `GET /api/specs/:id/artifacts/:kind`         | an artifact, optionally `?version=`    |
| `GET /api/specs/:id/artifacts/:kind/diff`    | diff between two versions              |
| `POST /api/specs/:id/artifacts/:kind/decide` | approve, reject or request changes     |
| `GET /api/specs/:id/audit`                   | the audit trail                        |
| `GET /api/specs/:id/cost`                    | measured spend, tokens, cache hit rate |
| `GET /api/specs/:id/compliance/trace`        | the trace matrix and coverage          |
| `GET /api/compliance/pack`                   | the rule pack                          |
| `GET /api/specs/:id/stream`                  | SSE run progress (authenticated)       |

Agent routes are idempotent on an idempotency key: a retry returns the artifact the first
attempt produced. The `/api/public/*` routes back the interactive demos on the marketing
site. A test fails the build if a route is undocumented or a documented route is missing.

---

## Connecting Claude Code

The MCP server and the edit hook ship as one Claude Code plugin at `packages/plugin`.
`--plugin-dir` loads both; nothing is registered by hand.

1. **Release a spec.** In the workspace approve requirements, design, then tasks. Approving
   tasks moves the spec to `READY_FOR_IMPLEMENTATION`, the state that permits edits.
2. **Pin the target repository to the spec.** In the repo where Claude Code will write code:

   ```bash
   mkdir -p .sdd && echo "<spec-id>" > .sdd/current-spec
   ```

   Setting `SDD_SPEC_ID` in the environment works too.

3. **Start Claude Code with the plugin**, from that repository, using an absolute database
   path because the session runs somewhere else:

   ```bash
   export SDD_DB_PATH=/absolute/path/to/agentforge/data/agentforge.db
   claude --plugin-dir /absolute/path/to/agentforge/packages/plugin
   ```

   On Windows `cmd`: `set SDD_DB_PATH=D:\path\to\agentforge\data\agentforge.db`. The plugin
   manifest deliberately sets no environment variables.

4. **Tell it what to do:**

   > Call get_approved_spec, then next_task, then start_task, implement that one task, then
   > complete_task with evidence naming the files.

Interactively, Claude Code asks you once to approve the `agentforge-sdd` tools. In `-p`
mode add `--allowedTools "mcp__plugin_agentforge-sdd_agentforge-sdd__*" Write Read Edit`,
since it cannot prompt.

**MCP tools:** `get_approved_spec`, `get_acceptance_criteria`, `next_task`, `start_task`,
`complete_task` (with file evidence) and `release_task`. All go through the orchestrator;
none can approve anything.

**Skill:** `/sdd-implement` walks a session through the claim → implement → complete loop.

---

## Configuration

Set in `.env` (see `.env.example`).

| Variable                                                  | Meaning                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`                | gateway key; either works                                                  |
| `SDD_DB_PATH`                                             | SQLite file; relative paths resolve from the repo root                     |
| `SDD_RUN_COST_CAP_USD`                                    | hard spend ceiling per spec run; exceeding it aborts with `BUDGET_EXCEEDED` |
| `SDD_MODEL_CONTEXT`, `_REQUIREMENTS`, `_DESIGN`, `_TASKS` | model per stage                                                            |
| `SDD_MAX_TOOL_CALLS`                                      | Context Agent tool-call ceiling (default 25)                               |
| `SDD_MAX_PROMPT_TOKENS`                                   | prompt ceiling for the loop (default 100000)                               |
| `SDD_MAX_OUTPUT_TOKENS`                                   | optional output-ceiling override                                           |
| `SDD_EFFORT_OVERRIDE`                                     | `low`, `medium`, `high`, `xhigh` or `max`, overriding per-stage effort     |
| `SDD_CASSETTE_MODE`                                       | `off`, `record` or `replay` for recorded LLM responses                     |
| `SDD_CASSETTE_DIR`                                        | where cassettes live                                                       |
| `LOG_LEVEL`                                               | pino log level                                                             |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`                   | session signing secret and the origin cookies are issued for              |

Models are configuration: `claude-haiku-5-5` for development and the context loop,
`claude-sonnet-5-5` for demo runs.

---

## Commands

```bash
npm install
npm run dev                # Next.js at http://localhost:3000
npm run build
npm run db:migrate         # apply SQL migrations
npm run db:seed            # three fixture specs at different lifecycle points
npm run db:reset           # delete the database and re-migrate (refuses paths outside cwd)
npm run ci                 # typecheck + lint + format:check + test with coverage + next build
npm run test               # vitest
npm run test:watch
npm run test:cov
npm run lint:fix
npm run format

# No API key, $0
npm run sdd:scan -- <repo> [focus...]         # stage-0 scan and verifier demo
npm run eval -- <repo>... [--commits 15]      # deterministic retrieval ablation

# Live, billable
npm run sdd:smoke                             # greenfield CREATED -> DESIGN_AWAITING_APPROVAL
npm run sdd:smoke:brownfield -- <repo> [req]  # Case B: scan, loop, verify, measured cost
npm run sdd:smoke:tasks                       # requirements -> design -> tasks on a scratch DB
npm run sdd:smoke:implement                   # the implementation hand-off
npm run eval:agentic -- <repo>... [options]   # agentic retrieval ablation
```

`eval:agentic` options: `--commits N` (default 15), `--arms a,b,c`, `--concurrency N`
(default 3), `--budget USD` (default 4.00), `--run-cap USD` (default 0.15),
`--max-tool-calls N`, `--model ID`, `--out DIR`.

---

## The LLM layer

- **Structured outputs.** Every agent uses `output_config.format` with a Zod schema and the
  response is re-validated locally, because the JSON-schema conversion turns string lengths
  and array bounds into descriptions the API does not enforce. A malformed response is a
  logged failure.
- **Streaming.** Every request streams. The design and task stages need a large output
  ceiling (the compliance pack adds criteria, and thinking tokens count against the same
  budget); ceilings are per stage in `llm/src/config.ts`.
- **No `thinking` config.** Adaptive thinking is the default; depth is set with
  `output_config.effort` per stage.
- **Prompt caching.** Prefixes are byte-stable and ordered: system prompt, compliance pack,
  repo map, module summaries, approved artifacts. No timestamps or ids appear in the prefix.
- **Gateway.** Confined to `llm/src/provider.ts`. OpenRouter serves an Anthropic-format
  `/v1/messages`, so the same SDK and structured outputs apply. Model ids are canonical
  inside the system and translated at the edge.
- **Cost accounting.** Every call is recorded to `llm_calls` with token and cache counters.
  `cost_source` says whether a figure was `reported` by the gateway or `computed` from the
  list-price table; `npm run sdd:smoke` re-checks the table against the gateway on every run
  (currently a 0.00% difference).
- **Budgets.** A per-run cap is checked before a call is made.
- **Cassettes.** `record` captures responses, `replay` serves them offline. A prompt edit
  misses the cassette rather than passing against a stale recording.
- **Retries** only on 429 and 5xx, with exponential backoff and jitter.
- **Correlation ids** thread through transitions, audit entries and LLM calls.

---

## Evaluation

`packages/eval` measures retrieval against ground truth mined from git history.

**Ground truth.** Feature commits are mined from a repository (merge commits, chores and
sweeping refactors filtered out). The gold set for a commit is the pre-existing source files
it modified. Retrieval runs against the commit's **parent** in a detached worktree, so files
the feature created cannot leak in; the query is the commit subject (and body) only.

**Deterministic ablation** (`npm run eval`): four arms (`grep`, `repomap`, `fts`,
`fts_repomap`) rank repository files with no model in the loop. Reports recall@1/5/10/20,
precision@10 and MRR as mean ± sample standard deviation across commits. Free and exactly
reproducible.

**Agentic ablation** (`npm run eval:agentic`): runs the full Context Agent once per arm per
commit on the same mined commits, with module summaries skipped so each arm gets only its
tools. Scored over the files cited in verified claims. It also records, per run, tool calls,
tokens, cache hit rate, unverified-claim rate, cost and wall time. Properties of the runner:

- every run is appended to `journal.jsonl` the moment it completes, so an interrupted run
  resumes without repeating paid work;
- a total budget stops new runs from being scheduled, counting the journal's history, and a
  per-run cap bounds any single run;
- failed runs are recorded with the money they cost;
- only commits where every arm completed are scored, so arms are compared on identical
  ground;
- every model response is recorded as a cassette, so the experiment can be re-scored offline.

---

## Measured results

All live figures come from `llm_calls` on runs through OpenRouter on Haiku 5.5 unless stated.

| Run                                              | Result                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenfield, `CREATED → DESIGN_AWAITING_APPROVAL` | 16 requirements with compliance criteria attached, 11 design sections, 4 recorded decisions, 10 risks. **$0.0186**, 2 calls.                                   |
| Brownfield Case B against this repository       | 15 of 25 tool calls, **11.1% unverified-claim rate**, **$0.0133**, 13 calls, 34.3% cache hit rate.                                                             |
| Task Agent on Sonnet 5.5 (scratch database)      | 8 tasks, no unknown ids, no dependency cycle, every acceptance criterion verified; one call, **$0.081**, 25 s.                                                 |
| Agentic retrieval runs, Haiku 5.5                | about **$0.008 per run** over the first 20 runs (14 to 56 s each, no failures).                                                                                |

### Retrieval ablation, recall@10, 15 mined commits per repository

Re-run on fresh clones of `execa` (HEAD `247faa0`) and `requests` (HEAD `3c7baaa`):

| arm           | execa (TypeScript) | requests (Python) |
| ------------- | ------------------ | ----------------- |
| `grep`        | 0.022 ± 0.086      | 0.556 ± 0.402     |
| `repomap`     | 0.117 ± 0.208      | 0.565 ± 0.331     |
| `fts`         | **0.344 ± 0.290**  | 0.474 ± 0.396     |
| `fts_repomap` | 0.233 ± 0.286      | **0.598 ± 0.373** |

Full tables (recall@1/5/10/20, precision@10, MRR) come from `npm run eval`. On the
TypeScript repository the lexical index is worth about 15× `grep`; on the Python repository
`grep` is strong and the fused arm leads. The most elaborate arm is not the best arm on both
repositories.

---

## Testing

`vitest`, with a real temp SQLite file per suite. Agent suites replay recorded cassettes, so
the suite is offline and deterministic. **1,041 tests across 44 files**, all passing.
Coverage thresholds are enforced in `vitest.config.ts`: at least 90% statements on the
governance- and grounding-critical packages, at least 75% overall.

Two suites drive real subprocesses (the `PreToolUse` hook and the MCP server), because a hook
tested in-process would not prove the hook works.

| Suite                                         | What it proves                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator/test/transition.test.ts`        | all 225 ordered state pairs: every legal edge works, every illegal one is refused                                                               |
| `orchestrator/test/approvals.test.ts`         | hash binding, including against a forged artifact inserted by raw SQL                                                                           |
| `orchestrator/test/guards.test.ts`            | each guard driven to failure                                                                                                                    |
| `db/test/drift.test.ts`                       | SQL, Drizzle mirror and contract enums all agree                                                                                                |
| `agents/test/render.test.ts`                  | golden files: exact bytes, so traceability ids cannot drift                                                                                     |
| `agents/test/agents.test.ts`                  | greenfield CREATED → DESIGN_AWAITING_APPROVAL through the real gates; an invented file is refused; a bare Section 194J citation is refused      |
| `web/test/api.test.ts`                        | every route returns contract-valid data; a stale hash is 409                                                                                    |
| `web/test/routes.test.ts`                     | no undocumented routes, and no silently missing ones                                                                                            |
| `web/test/site-claims.test.ts`                | the build fails on marketing or docs claims the product cannot back                                                                             |
| `web/test/a11y.test.ts`                       | structural accessibility decisions are pinned                                                                                                   |
| `llm/test/client.test.ts`                     | budget refused before the call, one cache breakpoint, a stable prefix                                                                           |
| `llm/test/cassette.test.ts`                   | replay is offline and free; a prompt edit misses                                                                                                |
| `llm/test/toolloop.test.ts`                   | every budget driven to its limit                                                                                                                |
| `skills/test/skills.test.ts`                  | the prompt instructions the grounding guarantee depends on are still present                                                                    |
| `plugin/test/hook.test.ts`                    | the hook, as a real subprocess, denies edits in all 8 pre-release states and fails closed                                                       |
| `mcp-server/test/server.test.ts`              | the whole tool surface through a real MCP client; nothing can approve                                                                           |
| `compliance/test/compliance.test.ts`          | Section 194J is caught and mapped to 393; source disagreements stay disclosed; the pack installs on a fresh database                            |
| `context-agent/test/verifier.test.ts`         | adversarial citations: invented files, off-by-one ranges, symlink escapes, CRLF, binaries                                                       |
| `context-agent/test/repomap-quality.test.ts`  | the ranking filters, each pinned to the real-repo failure that motivated it                                                                     |
| `context-agent/test/scan.test.ts`             | path confinement; the git and fallback inventories agree                                                                                        |
| `context-agent/test/agent.test.ts`            | Case B end to end; an invented file lands in the unverified-claim rate; each strategy exposes a different tool set                              |
| `context-agent/test/tools.test.ts`            | adversarial tool arguments: traversal, absolute paths and symlinks out of the repo are refused                                                  |
| `eval/test/mine.test.ts`                      | the leakage control: a created file really is absent from the parent worktree                                                                   |
| `eval/test/metrics.test.ts`                   | recall, precision and MRR against hand-computed values                                                                                          |
| `eval/test/agentic.test.ts`                   | the agentic runner against a real git repository with only the model transport faked: scoring, journaling, resuming, budget stop, failures      |

---

## Engineering rules

Enforced by CI, not by good intentions.

- **`transition()` is the only writer of `specs.status`.** A `no-restricted-syntax` lint
  rule blocks `update(specs)` anywhere else.
- **No agent may approve.** Approval edges admit only `actor.type === 'human'`, and the HTTP
  layer hard-codes requests to `human`.
- **Approvals bind to a content hash.** Artifact versions are immutable by trigger.
- **Audit log and approvals are append-only,** by trigger. Removal is wholesale only, by
  deleting the whole spec.
- **Validate at every trust boundary:** request bodies, query strings, every LLM payload,
  every JSON column read from SQLite.
- **No `any`, no swallowed errors.** `no-explicit-any` and `no-unsafe-*` are errors; `catch {}`
  is banned.
- **Repository content is data, never instructions.**
- **Agents propose; the orchestrator transitions.**
- **Every agent call is idempotent on its key,** and the replay check runs before the state
  guard.
- **No placeholder code on `main`.** `no-warning-comments` makes `TODO`/`FIXME` a lint error.
- TypeScript runs with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

---

## Conventions

- **Determinism.** Markdown is rendered from validated JSON by pure functions; no renderer
  reads the clock. A document that varied between renders would change its own hash and
  invalidate an approval.
- **Migrations are hand-written SQL** in `packages/db/src/migrations`, applied in filename
  order and checksum-guarded. Never edit an applied migration; add a new one.
  `packages/db/src/schema.ts` is a Drizzle mirror kept honest by `drift.test.ts`.
- **Enum values are spelled once,** in `packages/contract/src/states.ts`.
- **Prompt prefixes are byte-stable** (see [The LLM layer](#the-llm-layer)).
- **The file inventory comes from `git ls-files`,** not ripgrep, so the product does not
  depend on a binary that may be absent on a plain Windows install.
- **The repo map ranks module-level API only.** Locals, short names, test-file definitions,
  property accesses and names defined in more than two files are excluded.
- **Cost provenance is recorded,** not assumed.
- **Correlation ids** thread through every run so it can be reconstructed from the database
  or logs alone.
