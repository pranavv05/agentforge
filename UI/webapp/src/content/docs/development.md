# Development process and models

How AgentForge was built, which models it runs on, and what has and has not been proven yet. Everything here comes from the project's own build notes, CI configuration and code, not from marketing.

## How it was planned

The build started with research, not code. The plan compared retrieval strategies, orchestration options and the existing spec tools (Spec Kit, OpenSpec, BMAD, Kiro, Spec Workflow MCP) before choosing a direction.

- **Many tools already write the three documents.** Requirements, design and tasks are a commodity, so the pipeline itself is not the product.
- **The product is what those tools do not claim:** server-enforced governance, evidence checked against real files, and compliance traceability.
- **The scope was kept narrow on purpose.** The compliance pack covers GST e-invoice and TDS under Section 393 only. Hindi and Hinglish are input-only. Anything that needed organisation onboarding to test was dropped.

## The build, in five days

The platform was built in five planned days, with CI green throughout.

| Day | What was built | Status |
|---|---|---|
| 1 | Frozen contract, SQLite schema, the governance orchestrator, read and approval APIs, fixtures | Done |
| 2 | The Claude API wrapper, four prompt files, the Requirement and Design agents, streaming | Done |
| 3 | The 15-rule GST and TDS compliance pack, the Task agent, the MCP server, the Claude Code plugin with the edit hook | Done |
| 4 | Context Agent stage 0 (file inventory, manifests, repo map, full-text index) and the grounding verifier | Offline half done |
| 5 | Context Agent stages 1 and 2, the evaluation harness, measured costs | Not built yet |

## Architecture decisions

### A hand-rolled state machine, not a framework

Stage changes live in one database-backed function, roughly 300 to 500 lines of TypeScript. LangGraph, Mastra, the Claude Agent SDK and Temporal were all considered. A plain table of allowed moves was chosen because the governance rule ("agents propose, the orchestrator transitions, humans approve") has to be inspectable, and because a row in a database survives restarts and multi-day waits for a reviewer.

### No embeddings

Code retrieval uses an agentic search loop, seeded by two free local tools:

- A **repo map**: definitions and references parsed with tree-sitter and ranked, giving the agent a table of contents.
- **Full-text search**: SQLite FTS5 over paths, symbols and comments.

There is no vector database to keep in sync, so nothing goes stale. The loop is capped at 25 tool calls and keeps its prompt under 100K tokens.

### Models are configuration, not literals

No call site names a model. Each stage reads its model from the environment, and a model without a price entry is refused so spend is always measured.

## Models

| Role | Model | Why |
|---|---|---|
| Development and the context loop | Claude Haiku 5.5 | Lowest price, good enough for search and structured output |
| Demo runs: requirements, design, tasks | Claude Sonnet 5.5 | More judgement on the stages a human reviews |

| Model | Input per MTok | Output per MTok | Cache read per MTok |
|---|---|---|---|
| Haiku 5.5 | $0.10 | $0.50 | $0.01 |
| Sonnet 5.5 | $2.00 | $10.00 | $0.10 |

Haiku prices input about five times higher above 100K tokens, which is why the context loop stays under that line. It is a cost cliff, not an arbitrary limit.

### Effort per stage

Effort is set explicitly for every stage, because the defaults differ between models.

| Stage | Effort |
|---|---|
| Context scan, module summaries | low |
| Context loop, clarifying questions, tasks, compliance | medium |
| Requirements, design | high |

### How the calls are made

- **Structured outputs.** Every agent returns JSON that matches a schema, and the response is validated again locally. Nothing parses model prose.
- **Deterministic documents.** Markdown is rendered from validated JSON by pure functions. A document that changed between renders would change its own hash and silently void an approval.
- **Stable prompt prefixes.** The prompt is ordered system prompt, compliance pack, repo map, module summaries, approved artifacts, with no timestamps or ids, so prompt caching keeps hitting.
- **Every call is recorded** with its token and cache counters. Reported costs come from that ledger, never from an estimate.
- **Replayable tests.** Agent tests replay recorded responses ("cassettes"), so the suite is offline, free and deterministic.

## Quality bar

These rules are enforced by CI and lint, not by convention.

- Only one function may write a spec's status, and a lint rule blocks every other write.
- No approval edge admits an agent.
- Approvals bind to a content hash, and artifact versions are immutable.
- The audit log is append-only, enforced by database triggers.
- Input is validated at every trust boundary: request bodies, model output and stored JSON.
- No `any`, no swallowed errors, no `TODO` comments on the main branch.

Every push runs: typecheck, lint, format check, migrations from scratch and again for idempotence, fixture seeding, the test suite with coverage thresholds, and a production build. Coverage must be at least 90% on the governance and grounding packages and 75% overall.

The suite has 720 tests. The ones that carry the most weight:

| Suite | What it proves |
|---|---|
| Transition matrix | All 225 ordered state pairs: every legal move works, every illegal one is refused |
| Approvals | Hash binding holds, even against a forged artifact inserted with raw SQL |
| Verifier | Invented files, off-by-one ranges, symlink escapes, CRLF files and binaries are all handled |
| Edit hook | Run as a real subprocess, it denies edits in all eight pre-release states and fails closed on any error |
| MCP server | Driven through a real client: the agent's whole tool surface, and nothing in it can approve |
| Compliance | Section 194J is caught and mapped to Section 393, and disagreements between sources stay disclosed |

## What this site runs

This website is a lightweight web build of the governance layer, on Hono, Cloudflare Workers and D1. The full platform is a Next.js app on SQLite.

- **Real here:** the state machine, hash-bound approvals, the append-only audit log, the grounding verifier, the compliance lint, cost accounting and sign-in.
- **Simulated here:** model output, token counts and the repository. Output is generated deterministically and priced with the real table above.

See [the FAQ](/docs/faq#what-is-simulated) for the full list.

## What is not proven yet

- **No live model run yet.** No API key has been configured, so no agent has run against the live API. The agent tests use a stub client that exercises everything except the HTTP call. Prompt quality is untested against a real model.
- **The compliance pack has not been reviewed by a tax professional.** Rates and codes are encoded only where the research states them. Confirm every rate, threshold and code against the official portals before real use.
- **Costs are estimates.** The figures of about $0.65 to $1.05 per brownfield feature come from the plan's arithmetic. The evaluation harness that replaces them with measured numbers is not built.
- **The edit hook has a stated scope.** It governs sessions pinned to a spec and guards against a capable model drifting off-spec, not an adversary with shell access. Whether it still applies when permissions are bypassed has not been tested in a live session, so it is not claimed.

## Next

- Context Agent stages 1 and 2: per-module summaries through the batch API, and the budgeted search loop.
- The evaluation harness: ground truth mined from git history, a retrieval comparison, and measured costs.
- Live model runs with a real key, then a review of prompt quality.

Read [Core concepts](/docs/concepts) for how the governance works, or [Bring your own key](/docs/byok) for how to connect your API key.
