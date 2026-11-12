# Development process and models

How AgentForge was built, which models it runs on, and what has and has not been proven.
Everything here comes from the project's own build notes, CI configuration and code.

## How it was planned

The build started with research, not code. The plan compared retrieval strategies,
orchestration options and the existing spec tools — Spec Kit, OpenSpec, BMAD, Kiro, Spec
Workflow MCP — before choosing a direction.

- **Many tools already write the three documents.** Requirements, design and tasks are a
  commodity, so the pipeline itself is not the product.
- **The product is what those tools do not claim:** server-enforced governance, evidence
  checked against real files, and compliance traceability.
- **Scope was kept narrow on purpose.** The compliance pack covers GST e-invoice and TDS
  under Section 393 only. Hindi and Hinglish are input-only. Anything needing
  organisation onboarding to test was dropped.

## The build, in five days

| Day | What was built |
|---|---|
| 1 | Frozen contract, SQLite schema, the governance orchestrator, read and approval APIs, fixtures |
| 2 | The Claude API wrapper, four SKILL.md prompts, the Requirement and Design agents, SSE streaming |
| 3 | The 15-rule GST and TDS pack, the Task agent, the MCP server, the Claude Code plugin and edit hook |
| 4 | Context Agent stages 0–3: inventory, manifests, tree-sitter repo map, FTS5 index, cached module summaries, the budgeted loop, and the grounding verifier |
| 5 | The evaluation harness: ground truth mined from git history, the retrieval ablation, and measured costs replacing the plan's estimates |

Every stage has since been run against a live model.

## Architecture decisions

### A hand-rolled state machine, not a framework

Stage changes live in one database-backed function. LangGraph, Mastra, the Claude Agent
SDK and Temporal were all considered. A plain table of allowed moves was chosen because
the governance rule has to be inspectable, and because a row in a database survives
restarts and multi-day waits for a reviewer.

### No embeddings

Retrieval is an agentic search loop seeded by two free local tools: a tree-sitter **repo
map** ranked to give the agent a table of contents, and **FTS5 full-text search** over
paths, symbols and comments. There is no vector database to keep in sync, so nothing goes
stale.

The repo map ranks module-level API only. Locals, names under three characters,
test-file definitions, property accesses and names defined in more than two files are all
excluded — each is unresolvable or noise under name-based symbol resolution, and each
filter is pinned to the real-repository failure that motivated it.

### Models are configuration, not literals

No call site names a model. Each stage reads its model from configuration, and a model
without a price entry is refused, so spend is always measurable.

## Models

| Role | Model | Why |
|---|---|---|
| Development and the context loop | Claude Haiku 5.5 | Lowest price, good enough for search and structured output |
| Demo runs: requirements, design, tasks | Claude Sonnet 5.5 | More judgement on the stages a human reviews |

Haiku prices input about five times higher above 100K tokens, which is why the context
loop stays under that line. It is a cost cliff, not an arbitrary limit.

### Effort per stage

Set explicitly everywhere, because defaults differ between models.

| Stage | Effort |
|---|---|
| Context scan, module summaries | low |
| Context loop, clarifying questions, tasks, compliance | medium |
| Requirements, design | high |

Thinking configuration is never sent: adaptive thinking is the default on these models,
and an explicit `disabled` or a `budget_tokens` value is a 400.

### How the calls are made

- **Structured outputs, not forced tool use.** Every agent returns JSON against a schema
  via `output_config.format`, and the response is re-validated locally — the JSON-schema
  conversion moves string lengths and array bounds into descriptions the API does not
  enforce, and a live run exceeded one on its first brownfield scan.
- **Deterministic documents.** Markdown is rendered from validated JSON by pure
  functions, and no renderer reads the clock. A document that varied between renders
  would change its own hash and silently void an approval.
- **Stable prompt prefixes:** system prompt, compliance pack, repo map, module summaries,
  approved artifacts — with no timestamps or ids, so prompt caching keeps hitting.
- **Every request streams.** The SDK refuses a non-streaming request whose `max_tokens`
  could exceed its ten-minute ceiling, and the design and task stages need a large
  ceiling because thinking tokens are charged against the same output budget.
- **Every call is recorded** with its cache counters, and `cost_source` says whether the
  figure was reported by the gateway or computed from the price table.

## Quality bar

Enforced by CI and lint, not by convention.

- One function may write a spec's status; a lint rule blocks every other write.
- No approval edge admits an agent.
- Approvals bind to a content hash, and artifact versions are immutable by trigger.
- The audit log is append-only, enforced by database triggers.
- Input is validated at every trust boundary: request bodies, model output, stored JSON.
- No `any`, no swallowed errors, no `TODO` on the main branch.

Every push runs typecheck, lint, format check, the test suite with coverage thresholds,
and a production build. Coverage must be at least 90% on the governance and grounding
packages and 75% overall.

The suite has **882 tests**. The ones carrying the most weight:

| Suite | What it proves |
|---|---|
| Transition matrix | All 225 ordered state pairs: every legal move works, every illegal one is refused |
| Reachability | Every edge in the table names what drives it, so a legal-but-unreachable edge cannot hide |
| Pipeline | One spec from `CREATED` to `DONE` through the real routes, with three human gates and no agent-caused transition |
| Approvals | Hash binding holds, even against a forged artifact inserted with raw SQL |
| Verifier | Invented files, off-by-one ranges, symlink escapes, CRLF files and binaries |
| Edit hook | Run as a real subprocess: denies edits in all eight pre-release states and fails closed |
| MCP server | Driven through a real client; nothing on the tool surface can approve |
| Compliance | Section 194J is caught and mapped to 393, and source disagreements stay disclosed |

## Measured, not estimated

All figures from `llm_calls` on live runs through OpenRouter on Haiku 5.5. The cost model
is re-verified against the gateway's own reported figure on every smoke run; the current
difference is 0.00%.

| Run | Result |
|---|---|
| Greenfield, `CREATED` → `DESIGN_AWAITING_APPROVAL` | 16 requirements, 11 design sections, 4 decisions, 10 risks. **$0.0186**, 2 calls |
| Brownfield scan of this repository | 15 of 25 tool calls, 11.1% unverified-claim rate, 34.3% cache hit rate. **$0.0133**, 13 calls |

The plan estimated roughly $0.60 per greenfield feature on Sonnet. The measured figure on
Haiku is two orders of magnitude lower, which is the whole argument for the
Haiku-plus-retrieval design rather than a larger model with a bigger prompt.

## Proven end to end

A real Claude Code session, with the plugin loaded, was told to create a file in a
repository pinned to a released spec with no task claimed. The hook denied the write, and
the session stopped and said it could have used a shell redirect but would not route
around a guard the project installed.

The same session, once a task was claimed, implemented it and recorded completion
evidence tracing the code back to specific requirements, decisions and acceptance
criteria — including a plain statement of which tests it could not run.

## What is not proven

- **The compliance pack has not been reviewed by a tax professional.** Confirm every
  rate, threshold and code against the official portals before real use.
- **The agentic ablation has not been run.** The published arms compare *retrieval*
  deterministically over 15 commits per repository. Running the full loop per arm per
  commit would measure the system as used, but costs money per run and varies between
  runs.
- **Two fixture repositories were used where three were planned.**
- **The edit hook has a stated scope.** It governs sessions pinned to a spec and guards
  against a capable model drifting off-spec, not an adversary with shell access. Whether
  it still applies when permissions are bypassed has not been tested, so it is not
  claimed.

Read [Core concepts](/docs/concepts) for how the governance works.
