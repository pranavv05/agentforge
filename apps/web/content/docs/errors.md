# Errors and troubleshooting

## Error codes

Every failure returns a code from one closed list, declared once in
`packages/contract/src/errors.ts` and used everywhere.

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | A field is missing or invalid at a trust boundary | Read `message` and fix the input |
| `UNAUTHENTICATED` | 401 | No signed-in user | Sign in again |
| `BUDGET_EXCEEDED` | 402 | The next model call would cross the run's spend cap | Raise `SDD_RUN_COST_CAP_USD`, or accept the stop |
| `BUDGET_LIMIT_REACHED` | 402 | A budget inside the agentic loop ran out — tool calls, tokens or wall clock | Narrow the request, or raise the loop's limits |
| `NOT_FOUND` | 404 | No such spec, artifact or task | Check the id |
| `ILLEGAL_TRANSITION` | 409 | That move is not in the transition table, or the actor may not make it — agents can never approve | Reload and check the current state |
| `VERSION_CONFLICT` | 409 | Someone changed the spec first | Reload and retry |
| `HASH_MISMATCH` | 409 | The hash you approved is not the current document | Reload, re-read, then decide again |
| `PRECONDITION_FAILED` | 409 | A guard refused: nothing is awaiting approval, a dependency is incomplete, a required artifact does not exist | Check the spec status |
| `GROUNDING_FAILED` | 409 | A citation could not be verified against the repository | Re-run the scan, or read the evidence list |
| `COMPLIANCE_VIOLATION` | 409 | A document cites a superseded rule, such as Section 194J instead of Section 393 | Use the mapped rule |
| `PATH_ESCAPES_ROOT` | 400 | A tool argument resolved outside the repository root | Not actionable from a client; the confinement is working |
| `UPSTREAM_FAILED` | 502 | The model gateway failed after retries | Retry; 429 and 5xx are already retried with backoff |
| `INTERNAL` | 500 | Unexpected server error | Retry, and quote the `correlation_id` |

## Reading a failure

Every error body carries a `correlation_id` that also appears in the structured logs and
in the `llm_calls` row for that run, so any failure can be reconstructed from the
database or the logs alone.

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "expected version 7, found 8",
    "details": null,
    "correlation_id": "..."
  }
}
```

## Things that look like bugs but are the product working

**`HASH_MISMATCH` when you approve.** The document changed after you opened it. The
approval binds to bytes, so it must be refused rather than re-pointed at different
content. Reload, read the new version, decide again.

**`PRECONDITION_FAILED` on task generation.** The design is not approved yet, or tasks
already exist. `TASKS_GENERATED` is a *result* state: the agent runs first and the
orchestrator records the move afterwards.

**The hook denied an edit while the spec is `READY_FOR_IMPLEMENTATION`.** Being released
is not sufficient — a task must also be claimed, so every change is attributable to a
task and its acceptance criteria. Call `start_task` first.

**`VALIDATION_FAILED` when creating a brownfield spec.** The repository path is resolved
and checked before anything is written. The message names the path it tried.
