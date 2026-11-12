# Core concepts

## The pipeline

Every spec moves through the same states, and only the orchestrator writes `specs.status`.

| Stage | Output | Gate |
|---|---|---|
| Context *(brownfield only)* | `context.md`: repo map, module summaries, verified `file:line` claims | None |
| Requirements | `requirements.md` in EARS form, with acceptance criteria | Clarifying questions, then **your approval** |
| Design | `design.md`, citing evidence for every claim about existing code | **Your approval** |
| Tasks | `tasks.md`, ordered and traced to requirements and criteria | **Your approval** — this is what permits file edits |
| Implementation | Tasks claimed and completed with evidence, over MCP | Reached only through the gate above |

Three gates, not two. The tasks gate exists because that edge is where file edits become
permitted, and a machine should not be the thing that opens it.

The full state list: `CREATED`, `CONTEXT_SCANNING`, `CONTEXT_READY`, `REQ_DRAFTING`,
`REQ_AWAITING_CLARIFICATION`, `REQ_AWAITING_APPROVAL`, `REQ_APPROVED`, `DESIGN_DRAFTING`,
`DESIGN_AWAITING_APPROVAL`, `DESIGN_APPROVED`, `TASKS_GENERATED`,
`READY_FOR_IMPLEMENTATION`, `IMPLEMENTING`, `DONE`, `FAILED`.

**Request changes** returns a spec to the matching drafting state with your comment
attached. The agent drafts a new version; the old one stays in the version history, and
any two versions can be compared.

## The governance rule

> Agents propose, the orchestrator transitions, humans approve.

- `transition()` is the only writer of `specs.status`. A lint rule blocks `update(specs)`
  anywhere else, so this is enforced at build time rather than by review.
- Approval edges admit only `actor.type === 'human'`, and the HTTP layer hard-codes
  requests to `human`, so no caller can impersonate an agent and no agent can reach an
  approval edge.
- Every transition carries an `expectedVersion`. A stale page cannot overwrite newer
  state; it gets `VERSION_CONFLICT` and nothing moves.
- Design drafting refuses to start unless the approved requirements hash still matches
  the current requirements artifact.

## Approvals bind to bytes

An approval records who decided, what they decided, and the SHA-256 hash of the artifact
version. Artifact versions are immutable at the database level: editing one produces a
new version with a new hash, which invalidates the stale approval rather than quietly
carrying it forward. If the artifact changes before you submit, the API returns
`HASH_MISMATCH` and records nothing.

## The audit log

Each transition appends a row naming the actor, the states either side, and a
correlation id. Database triggers refuse `UPDATE` unconditionally, and refuse `DELETE`
while the parent spec exists — so history cannot be edited or thinned out. The only way
to remove it is to delete the whole spec, which cascades everything away together.

That distinction is the point: there is no selective edit, only wholesale removal.

## The edit hook

A Claude Code `PreToolUse` hook, shipped in the plugin. It answers one question before
each tool call: may this edit run right now?

Its scope, stated precisely because the claim is only worth what it can back:

- it governs sessions pinned to a spec, via `SDD_SPEC_ID` or a `.sdd/current-spec` file;
- it refuses `Edit`, `Write`, `NotebookEdit` and `MultiEdit` outside
  `READY_FOR_IMPLEMENTATION` and `IMPLEMENTING`, **and** when no task is claimed;
- it fails closed on any internal error;
- read-only tools are never touched.

The threat model is a capable model drifting off-spec, not an adversary with shell
access — a hook cannot govern what it is not asked about, and `Bash` is not an edit tool.
Whether a `PreToolUse` hook still applies under `bypassPermissions` is **not confirmed**,
and is not claimed.

## Spend caps

Model calls are billed to the key configured on the server. `SDD_RUN_COST_CAP_USD` sets
the ceiling for a run; before each call the orchestrator checks the projected total and
refuses with `BUDGET_EXCEEDED` (HTTP 402) if the call would cross it. The refusal happens
*before* the request is sent, so nothing is spent.

Every call is recorded to `llm_calls` with its token counts and cache counters, and
`cost_source` records whether the figure was reported by the gateway or computed from the
list-price table. Per-feature costs come from that table and never from an estimate.

| Profile | Model | Used for |
|---|---|---|
| Development | `claude-haiku-5-5` | Every stage, and the whole context loop |
| Demo | `claude-sonnet-5-5` | Requirements and design on demo runs |

The agentic context loop keeps its prompt under 100K tokens, because Haiku prices five
times higher above that threshold. That is a cost cliff, not an arbitrary limit.

## Hindi and Hinglish input

A feature request can be written in Hindi or Hinglish. The generated spec is always
English, so only the input is multilingual.
