# AgentForge

An agentic spec-driven development platform. It takes a feature request, produces
`requirements.md`, `design.md` and `tasks.md` through a chain of agents, and hands the
approved tasks to Claude Code for implementation.

Many tools already generate those three documents. The defensible parts here are the
three things none of them claim:

1. **Server-enforced governance.** Stage transitions are owned by a deterministic
   orchestrator. Approvals bind to a content hash, the audit log is append-only at the
   database level, and a Claude Code `PreToolUse` hook denies file edits outside an
   approved state. In the comparable tools, gates are conventions a model or human is
   trusted to follow.

   Scope of the hook, stated precisely because the claim is only worth what it can
   back: it governs sessions pinned to a spec (via `SDD_SPEC_ID` or
   `.sdd/current-spec`), refuses Edit/Write/NotebookEdit/MultiEdit outside
   `READY_FOR_IMPLEMENTATION`/`IMPLEMENTING` *and* when no task is claimed, and fails
   closed on any internal error. The threat model is a capable model drifting off-spec,
   not an adversary with shell access. Whether a `PreToolUse` hook still applies under
   `bypassPermissions` is **not confirmed** — do not claim it does without testing it in
   a live session.
2. **Evidence-checked brownfield specs.** Every claim an agent makes about existing code
   carries a `file:line` reference that deterministic code verifies. Claims that fail are
   flagged before they reach a document, and the *unverified-claim rate* is reported as a
   measurable hallucination metric.
3. **Compliance as acceptance criteria.** A versioned GST/TDS rule pack injects testable
   Given/When/Then criteria and traces each one rule → requirement → design → task → test.

## Commands

```bash
npm install            # approves better-sqlite3 + esbuild install scripts via package.json
npm run dev            # Next.js at http://localhost:3000
npm run db:migrate     # apply SQL migrations (idempotent, checksum-guarded)
npm run db:seed        # load three fixture specs at different lifecycle points
npm run db:reset       # delete the database and re-migrate (refuses paths outside cwd)
npm run ci             # typecheck + lint + format:check + test with coverage + next build
npm run test           # vitest
npm run test:watch

# No API key, $0
npm run sdd:scan -- <repo> [focus...]         # stage-0 scan + verifier demo
npm run eval -- <repo>... [--commits 15]      # retrieval ablation, writes results.{json,md}

# Live, billable
npm run sdd:smoke                             # greenfield CREATED -> DESIGN_AWAITING_APPROVAL
npm run sdd:smoke:brownfield -- <repo> [req]  # Case B: scan, loop, verify, measured cost
```

## Layout

```
packages/
  contract/        Zod schemas, states, error taxonomy, HTTP contract.  FROZEN.
  db/              SQLite via better-sqlite3 + Drizzle; hand-written SQL migrations.
  orchestrator/    The state machine. The only writer of specs.status.
  agents/          Requirement/Design/Task agents + deterministic markdown renderers.
  llm/             Anthropic wrapper: structured outputs, caching, cassettes, usage logging.
  skills/          SKILL.md files — one source of truth for every agent prompt.
  context-agent/   Context Agent stages 0-3 and the grounding verifier.
  compliance/      Rule pack, criteria injector, trace matrix.
  mcp-server/      MCP tools for the implementation phase.
  plugin/          Claude Code plugin: PreToolUse hook + /sdd-implement skill.
  eval/            Ground-truth miner, retrieval ablation runner, metrics.
apps/web/
  app/api/**       Backend routes.
  app/(ui)/**      UI — owned by the frontend track.
  lib/             Route wrapper, row-to-wire mapping, diffing, auth stub.
```

`packages/contract` sits at the bottom of the dependency graph and imports nothing from
the other packages. It is also imported by the browser, so it must stay free of
`node:*` imports.

## Non-negotiable rules

These are enforced by CI, not by good intentions. If a change needs one of them relaxed,
that is a design discussion, not a lint-disable.

**`transition()` is the only writer of `specs.status`.** Agents write proposal
artifacts; humans record decisions; neither moves a spec. A `no-restricted-syntax` lint
rule blocks `update(specs)` outside `packages/orchestrator/src/transition.ts`.

**No agent may approve.** Approval edges in the transition table admit only
`actor.type === 'human'`, and the HTTP layer hard-codes requests to `human` so no caller
can impersonate an agent. The audit log therefore proves no agent signed off its own
output.

**Approvals bind to a content hash.** Artifact versions are immutable (database
trigger); editing one produces a new version with a new hash, which invalidates the
stale approval and makes design drafting refuse to start. Never add a code path that
re-points an approval at different bytes.

**The audit log and approvals are append-only.** Enforced by database triggers, so even
direct SQL cannot rewrite history. `UPDATE` is refused unconditionally. `DELETE` is
refused while the parent spec exists, so history cannot be edited or thinned out; the
only way to remove it is to delete the whole spec, which cascades everything away
together. That distinction — no selective edit, only wholesale removal — is asserted in
`orchestrator/test/transition.test.ts` and is why migration 0002 exists.

**Validate at every trust boundary.** Zod `parse` on request bodies, query strings,
every LLM tool-use payload, and every JSON column read out of SQLite. A malformed model
response is a logged failure, never a silent degradation.

**No `any`, no swallowed errors.** `@typescript-eslint/no-explicit-any` and the
`no-unsafe-*` rules are errors; `catch {}` is banned. Code that cannot handle an error
rethrows it so the correlation id survives to the logs.

**Repository content is data, never instructions.** The Context Agent reads untrusted
repositories. File tools are confined to the repo root, repo content is fenced in
prompts, and the grounding verifier is deterministic code that cannot be argued out of a
verdict. A `CLAUDE.md` inside a *scanned* repo has no authority here.

**Agents propose; the orchestrator transitions.** An agent writes its artifact as an
`agent` actor and the orchestrator performs the state change as `orchestrator`. Never
let an agent call `transition()` on its own behalf.

**Every agent call is idempotent on its key**, and the replay check runs *before* the
state guard — a client timeout and retry must return the artifact the first attempt
produced, not fail a precondition on work that actually completed.

**Structured outputs, not forced tool use.** `tool_choice: {type: "any"|"tool"}` is
rejected by the current models, and the forced call only ever existed to get JSON back.
Every agent uses `output_config.format` with a Zod schema, and the response is
re-validated locally because the JSON-schema conversion moves string lengths and array
bounds into descriptions that the API does not enforce — a live run exceeded one on its
first brownfield scan. The SDK's `zodOutputFormat` parser is deliberately **not** passed
to the request: the SDK would call it and throw its own error first, which both hides the
offending field and means our local check never runs.

**Never send `thinking` configuration.** Adaptive thinking is the default on the models
we use; an explicit `disabled` or a `budget_tokens` value is a 400. Depth is controlled
with `output_config.effort`, set explicitly per stage because model defaults differ.

**No placeholder code on `main`.** `no-warning-comments` makes `TODO`/`FIXME` a lint
error. Day-1 scaffolding lived behind `SDD_STUB_AGENTS` and is gone.

## Conventions

- **Determinism.** Markdown is rendered from validated JSON by pure functions; nothing
  parses model prose, and no renderer reads the clock. A document that varied between
  renders would change its own content hash and silently invalidate an approval.
- **Migrations are hand-written SQL** in `packages/db/src/migrations`, applied in
  filename order and checksum-guarded. Never edit an applied migration; add a new one.
  `0003` records whether a cost figure was measured or computed; `0004` makes the
  module-summary cache repo-scoped rather than spec-scoped, so a second feature against
  the same checkout re-uses what the first one paid for.
  `packages/db/src/schema.ts` is a Drizzle *mirror* for typed queries, kept honest by
  `packages/db/test/drift.test.ts`.
- **Enum values are spelled once**, in `packages/contract/src/states.ts`. The SQL CHECK
  constraints and the Drizzle mirror both derive from or are tested against them.
- **Prompt prefixes are byte-stable** and ordered system prompt → compliance pack → repo
  map → module summaries → approved artifacts. No timestamps or ids in the prefix, or
  caching stops hitting.
- **The gateway is confined to `llm/src/provider.ts`.** Either `ANTHROPIC_API_KEY` or
  `OPENROUTER_API_KEY` works: OpenRouter serves an Anthropic-format `/v1/messages`, so
  the same SDK, the same `output_config.format` structured outputs and the same
  `cache_control` breakpoints apply unchanged. Its base URL stops at `/api` — the SDK
  appends `/v1/messages` itself. Model ids stay canonical everywhere inside the system
  and are translated at the edge, so there is one pricing table and one set of
  `llm_calls.model` values regardless of which gateway served a run.
- **Every request streams.** Not a preference: the SDK refuses a non-streaming request
  whose `max_tokens` could exceed its ten-minute ceiling, and the design and task stages
  need a large ceiling because the compliance pack injects criteria (one feature produced
  16 requirements and 21 acceptance criteria) and **thinking tokens are charged against
  the same output budget**. Ceilings are per stage in `llm/src/config.ts`.
- **Cost provenance is recorded, not assumed.** A streamed response carries no gateway
  cost figure — the SDK rebuilds usage from the stream deltas and drops OpenRouter's
  non-standard `cost` field — so `llm_calls.cost_source` says whether a figure was
  `reported` or `computed`. The computed figure is only trustworthy if the gateway
  passes list pricing through, which `npm run sdd:smoke` re-checks on every run with one
  small non-streaming call. Current result: 0.00% difference.
- **Models are config, not literals.** `claude-haiku-5-5` for development and the
  context loop, `claude-sonnet-5-5` for demo runs. The agentic loop keeps its prompt
  under 100K tokens because Haiku prices above that threshold five times higher — a cost
  cliff, not an arbitrary limit.
- **Every LLM call is recorded** to `llm_calls` with its cache counters. Per-feature
  costs in the report come from that table, never from an estimate.
- **Correlation ids** thread through transitions, audit entries and LLM calls, so any run
  can be reconstructed from the database or the logs alone.
- **The file inventory comes from `git ls-files --cached --others --exclude-standard`**,
  not ripgrep. The plan specified `rg`, but it is not reliably on PATH (absent on a
  plain Windows install), and a product must not depend on a binary that happened to be
  present on the build machine. Git is already a hard dependency for the eval's
  ground-truth mining. Non-checkout directories fall back to a Node walk that still
  reads `.gitignore`, because getting that wrong puts a file like `secret.env` into a
  prompt.
- **The repo map ranks module-level API only.** Locals, names under three characters,
  test-file definitions, property accesses and names defined in more than two files are
  all excluded — each is unresolvable or noise under name-based symbol resolution. See
  `context-agent/test/repomap-quality.test.ts` for why each filter exists.

## Testing

`vitest`, with a real temp SQLite file per suite (`:memory:` is per-connection, so the
concurrency tests need a file). Agent suites replay recorded cassettes, so the suite is
offline and deterministic and a green build costs nothing.

Coverage thresholds are enforced in `vitest.config.ts`: ≥90% statements on the
governance- and grounding-critical packages, ≥75% overall.

`testTimeout` and `hookTimeout` are raised above the vitest defaults because two suites
drive real subprocesses — the `PreToolUse` hook and the MCP server are both exercised as
separate processes, since a hook tested in-process would not prove the hook works — and
one parses a whole repository with tree-sitter in its setup. The hook's own latency is
asserted separately, so the raised timeout does not loosen the requirement that it
answers fast.

The suites that are load-bearing rather than incidental:

| Suite | What it proves |
|---|---|
| `orchestrator/test/transition.test.ts` | all 225 ordered state pairs: every legal edge works, every illegal one is refused |
| `orchestrator/test/approvals.test.ts` | hash binding, including against a forged artifact inserted by raw SQL |
| `orchestrator/test/guards.test.ts` | each guard driven to failure |
| `db/test/drift.test.ts` | SQL, Drizzle mirror and contract enums all agree |
| `agents/test/render.test.ts` | golden files — exact bytes, so traceability ids cannot drift |
| `web/test/api.test.ts` | every route returns contract-valid data; stale hash is 409 |
| `web/test/routes.test.ts` | no undocumented routes, and no silently missing ones |
| `llm/test/client.test.ts` | budget refused before the call, one cache breakpoint, a stable prefix that cannot carry per-request content |
| `llm/test/cassette.test.ts` | replay is offline and free, and a prompt edit misses rather than passing against a stale recording |
| `agents/test/agents.test.ts` | greenfield CREATED → DESIGN_AWAITING_APPROVAL through the real gates; a citation to an invented file is refused |
| `skills/test/skills.test.ts` | the prompt instructions the grounding guarantee depends on are still present |
| `plugin/test/hook.test.ts` | the hook, run as a real subprocess, denies edits in all 8 pre-release states and fails closed |
| `mcp-server/test/server.test.ts` | the agent's whole tool surface, driven through a real MCP client; nothing can approve |
| `compliance/test/compliance.test.ts` | Section 194J is caught and mapped to 393; source disagreements stay disclosed |
| `context-agent/test/verifier.test.ts` | adversarial citations: invented files, off-by-one ranges, symlink escapes, CRLF, binaries |
| `context-agent/test/repomap-quality.test.ts` | the ranking filters, each pinned to the real-repo failure that motivated it |
| `context-agent/test/scan.test.ts` | path confinement, and the git and fallback inventories agreeing |
| `context-agent/test/agent.test.ts` | Case B end to end: an invented file and an out-of-range symbol both land in the unverified-claim rate; the orchestrator, not the agent, performs the transition |
| `context-agent/test/tools.test.ts` | adversarial tool arguments: traversal, absolute paths and symlinks out of the repo all refused, and a bad argument answered rather than thrown |
| `llm/test/toolloop.test.ts` | every budget driven to its limit, including a parallel turn trying to exceed the tool cap |
| `eval/test/mine.test.ts` | the leakage control: a created file really is absent from the parent worktree, a modified one really is present |
| `eval/test/metrics.test.ts` | recall, precision and MRR against hand-computed values, and no spread claimed from one observation |

## Current state

Days 1-5 of 5; CI green throughout, 817 tests. Every stage has now been run against a
live model.

- **Day 1** — contract frozen, schema and orchestrator built and tested, read and
  approval APIs live, fixtures seeded.
- **Day 2** — the Claude API wrapper, the four SKILL.md prompts, the Requirement and
  Design agents, their routes, and SSE streaming.
- **Day 3** — the 15-rule GST/TDS compliance pack with superseded-term detection and the
  trace matrix; the Task Agent; the MCP server; and the Claude Code plugin with the
  `PreToolUse` hook.
- **Day 4** — Context Agent stage 0 (inventory, manifests, tree-sitter repo map, FTS5
  index) and stage 3, the grounding verifier; then stages 1 and 2, the cached module
  summaries and the budgeted agentic loop. Stages 0 and 3 are deterministic and need no
  API key; `npm run sdd:scan` runs them against any repository for nothing.
- **Day 5** — the eval harness: ground-truth mining from git history, the deterministic
  retrieval ablation, and measured per-feature costs replacing the plan's estimates.

### Measured, not estimated

All figures from `llm_calls` on live runs through OpenRouter on Haiku 5.5. Costs are
computed from the list-price table, which `npm run sdd:smoke` re-verifies against the
gateway's own reported cost on every run (currently a 0.00% difference).

| Run | Result |
|---|---|
| Greenfield, `CREATED → DESIGN_AWAITING_APPROVAL` | 16 requirements with compliance criteria attached, 11 design sections, 4 recorded decisions, 10 risks. **$0.0186**, 2 calls. |
| Brownfield Case B against this repository | 15 of 25 tool calls, **11.1% unverified-claim rate**, **$0.0133**, 13 calls, 34.3% cache hit rate. |

The plan estimated roughly $0.60 per greenfield feature on Sonnet; the measured figure on
Haiku is two orders of magnitude lower, which is the whole argument for the Haiku-plus-
retrieval design rather than a larger model with a bigger prompt.

### Retrieval ablation

`npm run eval -- <repo>...`, 15 mined feature commits per repository, recall@10:

| arm | execa (TypeScript) | requests (Python) |
|---|---|---|
| `grep` | 0.022 | 0.556 |
| `repomap` | 0.117 | 0.565 |
| `fts` | **0.344** | 0.474 |
| `fts_repomap` | 0.233 | **0.598** |

Two results worth stating plainly rather than smoothing: the lexical index is worth 15×
grep on the TypeScript repository and *less* than grep on the Python one, and fusing the
index with the repo map beats the index alone on one repository and loses on the other.
The most elaborate arm is not the best arm everywhere. Spreads are wide relative to the
means (often ±0.3 at n=15), which is the real variance of the task.

Recall is scored only against files that existed in the parent commit and were modified
by the feature. Scoring against files the feature *created* was the first version of the
harness, and it drove all four arms below 0.05 — a retriever cannot find a file that does
not exist yet. `packages/eval/src/mine.ts` carries the reasoning.

### Known gaps and cautions

**The compliance pack has not been reviewed by a tax professional.** Rates and payment
codes are encoded only where the research document states them; everything else is a
structural obligation rather than an invented number. Known source disagreements are
recorded in each rule's `source_conflict_note` and asserted by tests so they cannot be
tidied away. Confirm every rate, threshold and code against the CBDT portal and the
current NIC e-invoice schema before any real use.

**The agentic ablation has not been run.** The ablation arms compare *retrieval*
deterministically, over 15 commits per repository, for nothing. Running the full agentic
loop per arm per commit would measure the system as used, but costs money per run and
varies between runs, so it would cover a handful of commits at best. The deterministic
figures are the ones with a spread behind them, and the report should not present them as
the other thing.

**The `fts_repomap_embed` arm is named by the frozen contract but not implemented.** The
plan listed a local-embedding arm as an optional stretch. `scanContext` refuses it rather
than silently serving the `fts_repomap` tools under its name, which would put a row in the
results table that was never measured.

**Prompt quality is tested against a real model only for the paths the smoke scripts
cover** — greenfield requirements and design, and a brownfield scan. The Task Agent and
the compliance injector have been exercised offline against the stub, which runs every
line of the production path except the HTTP call, but not yet live.

**Accessibility was audited with axe-core in a real browser, and fixed — with stated residuals.**
It ran against the workspace (new spec, thread, requirements, tasks, context) in both
themes, and against the sign-in, sign-up, home, docs and compare pages. The workspace and
the auth, docs and compare pages finish with zero violations. It found real problems the
tests had missed: the light palette this project introduced failed AA contrast, a headline
sentence was `aria-hidden` with only a `<p aria-label>` standing in for it, scrollable
regions could not be reached by keyboard, and the skip link had no target in the workspace.
Residuals, not hidden: the home page's scroll-reveal manifesto starts at 1.4:1 by design
(mitigated under `prefers-contrast: more`, not removed), one link inside the tilted hero
mock-up is scaled below the 24px target size, and some `heading-order` findings remain on
the product pages. **Not verified:** screen-reader output (axe cannot judge it), and
focus restoration after a decision, which needs a real approval to exercise. A browser
audit cannot run in CI here, so `apps/web/test/a11y.test.ts` pins the structural
decisions only — it does not and cannot assert contrast or focus behaviour.

**Empty and failure states exist now, and some were only exercised statically.** The
workspace had no `loading`, `error` or `not-found` file at all, and four components
each translated errors their own way (mostly by showing the raw server message). Now one
function, `explainError`, branches on the error *code* and says what happened, whether
anything changed, and what to do; a first-run user sees the three-gate flow explained; the
example prompts are real buttons. Exercised live: the validation-error path (a real
`VALIDATION_FAILED`, with the correlation reference shown and no spec created), the
in-workspace not-found screen, and example-fills-composer. **Not exercised live:** the
error boundary (rendered statically and asserted, never actually thrown in a browser), the
loading skeleton (too fast to observe), the first-run view (verified by injecting its
markup, because the dev database has threads), and the Reload / Try again / Sign in
buttons on a failure — only their translation logic is tested.

**Phone layout is designed, and verified only in emulation.** Below 54rem the thread rail
becomes a drawer behind a top bar, the document becomes a sheet with a labelled way back,
and touch targets are 44px. Checked in a real browser at 390px against the live pages:
axe finds no violations on the thread, composer, requirements, tasks or context screens,
and the drawer is out of the tab order when closed, takes focus when opened, and returns
it on Escape. **Not verified:** a real device. The window could not be resized, so this
used a 390px iframe; iOS Safari's focus zoom, safe-area insets and dynamic toolbar
behaviour are therefore set from the documented rules and untested.

**Three fixture repositories were planned; two were used** (`execa`, `requests`). The
plan's cut order puts measurement breadth ahead of tests, CI, the verifier and the hook,
all of which are intact.

The `PENDING` list in `apps/web/test/routes.test.ts` is the authoritative record of
unimplemented routes, and that test fails if an entry goes stale. **It is now empty.**
