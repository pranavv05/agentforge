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
npm run ci             # typecheck + lint + format:check + test with coverage thresholds
npm run test           # vitest
npm run test:watch
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
bounds into descriptions that the API does not enforce.

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
  `packages/db/src/schema.ts` is a Drizzle *mirror* for typed queries, kept honest by
  `packages/db/test/drift.test.ts`.
- **Enum values are spelled once**, in `packages/contract/src/states.ts`. The SQL CHECK
  constraints and the Drizzle mirror both derive from or are tested against them.
- **Prompt prefixes are byte-stable** and ordered system prompt → compliance pack → repo
  map → module summaries → approved artifacts. No timestamps or ids in the prefix, or
  caching stops hitting.
- **Models are config, not literals.** `claude-haiku-5-5` for development and the
  context loop, `claude-sonnet-5-5` for demo runs. The agentic loop keeps its prompt
  under 100K tokens because Haiku prices above that threshold five times higher — a cost
  cliff, not an arbitrary limit.
- **Every LLM call is recorded** to `llm_calls` with its cache counters. Per-feature
  costs in the report come from that table, never from an estimate.
- **Correlation ids** thread through transitions, audit entries and LLM calls, so any run
  can be reconstructed from the database or the logs alone.

## Testing

`vitest`, with a real temp SQLite file per suite (`:memory:` is per-connection, so the
concurrency tests need a file). Agent suites replay recorded cassettes, so the suite is
offline and deterministic and a green build costs nothing.

Coverage thresholds are enforced in `vitest.config.ts`: ≥90% statements on the
governance- and grounding-critical packages, ≥75% overall.

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

## Current state

Days 1-3 of 5 are complete; CI green throughout.

- **Day 1** — contract frozen, schema and orchestrator built and tested, read and
  approval APIs live, fixtures seeded.
- **Day 2** — the Claude API wrapper, the four SKILL.md prompts, the Requirement and
  Design agents, their routes, and SSE streaming.
- **Day 3** — the 15-rule GST/TDS compliance pack with superseded-term detection and the
  trace matrix; the Task Agent; the MCP server; and the Claude Code plugin with the
  `PreToolUse` hook.

**No API key is configured yet**, so no agent has been run against the live API. The
agent suites inject a stub client, which exercises every line of the production path
except the HTTP call itself. Before the demo, run the pipeline once with
`ANTHROPIC_API_KEY` set and `SDD_CASSETTE_MODE=record` to capture real cassettes, then
switch CI to `replay`. Treat prompt quality as untested against a real model.

**The compliance pack has not been reviewed by a tax professional.** Rates and payment
codes are encoded only where the research document states them; everything else is a
structural obligation rather than an invented number. Known source disagreements are
recorded in each rule's `source_conflict_note` and asserted by tests so they cannot be
tidied away. Confirm every rate, threshold and code against the CBDT portal and the
current NIC e-invoice schema before any real use.

Not yet built — the `PENDING` list in `apps/web/test/routes.test.ts` is the authoritative
record, and that test fails if an entry goes stale: the Context Agent (stages 0-3 and the
grounding verifier) and the eval harness.
