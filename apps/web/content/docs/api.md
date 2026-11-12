# API reference

Base URL is the host you are signed in to. All bodies are JSON, and every request body,
query string and JSON column is validated with Zod at the boundary — a malformed request
is a logged failure, never a silent degradation.

## Authentication

Sessions are issued by [Better Auth](https://better-auth.com), served under
`/api/auth/*`, and carried in an HttpOnly cookie. The identity on that session becomes
the `actor` recorded in the audit log, so it is not merely a gate but the evidence behind
every approval.

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/api/auth/sign-up/email` | `name`, `email`, `password` | Create an account and sign in |
| POST | `/api/auth/sign-in/email` | `email`, `password` | Sign in |
| POST | `/api/auth/sign-out` | none | End the session |

```bash
curl -c jar.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"you@company.com","password":"your-password"}'
```

Every route below requires that cookie and answers `UNAUTHENTICATED` (401) without it.

## Specs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/specs` | List your specs with status, mode and cost |
| POST | `/api/specs` | Create a spec |
| GET | `/api/specs/:id` | One spec |
| GET | `/api/specs/:id/audit` | The append-only transition history |
| GET | `/api/specs/:id/cost` | Recorded model calls, tokens and cost |
| GET | `/api/specs/:id/tasks` | Tasks with status and completion evidence |

Creating a spec takes `mode` rather than a case letter, and `repo_path` is required for
`brownfield` and forbidden for `greenfield`:

```bash
curl -b jar.txt -X POST http://localhost:3000/api/specs \
  -H 'content-type: application/json' \
  -d '{
        "title": "Auto TDS on vendor payments",
        "description": "Deduct TDS at the Section 393 rate when paying a vendor.",
        "mode": "brownfield",
        "repo_path": "/absolute/path/to/checkout"
      }'
```

The path is resolved and stat-ed before any row is written, so a bad path is refused with
`VALIDATION_FAILED` and leaves nothing half-made.

## Running the agents

Each of these takes `expected_version` for optimistic locking and an `idempotency_key`.
The replay check runs *before* the state guard, so a client timeout and retry returns the
artifact the first attempt produced rather than failing a precondition on work that
actually completed.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/specs/:id/context/scan` | Brownfield context scan and grounding verification |
| POST | `/api/specs/:id/requirements/draft` | Draft or redraft requirements |
| POST | `/api/specs/:id/design/draft` | Draft the design from approved requirements |
| POST | `/api/specs/:id/tasks/generate` | Generate tasks from the approved design |
| GET | `/api/specs/:id/stream` | Server-sent events for a run in progress |

`context/scan` also takes `strategy`, one of `grep`, `repomap`, `fts` or `fts_repomap`.
The contract names a fifth, `fts_repomap_embed`; it is **not implemented** and is refused
rather than silently served by a different retriever.

## Artifacts and decisions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/specs/:id/artifacts/:kind` | Current version, or `?version=n` |
| GET | `/api/specs/:id/artifacts/:kind/diff?from=&to=` | Diff two versions |
| POST | `/api/specs/:id/artifacts/:kind/decide` | Approve or request changes |

`:kind` is one of `context`, `requirements`, `design`, `tasks`.

```bash
curl -b jar.txt -X POST \
  http://localhost:3000/api/specs/$ID/artifacts/requirements/decide \
  -H 'content-type: application/json' \
  -d '{
        "content_hash": "the hash shown above the document",
        "decision": "approve",
        "comment": null,
        "expected_version": 7
      }'
```

`decision` is `approve` or `request_changes`. A wrong `content_hash` returns
`HASH_MISMATCH` (409) and changes nothing — that refusal is the hash binding working, not
a bug.

## Clarifications and compliance

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/specs/:id/clarifications` | Open and answered questions |
| POST | `/api/specs/:id/clarifications/answer` | Answer one question |
| GET | `/api/specs/:id/context` | Evidence rows with verification results |
| GET | `/api/specs/:id/compliance/trace` | Rule → requirement → design → task → test |
| GET | `/api/compliance/pack` | The versioned rule pack |

## The implementation phase is not HTTP

There is no endpoint that claims or completes a task, and no endpoint that asks the hook
for a verdict. Implementation runs over MCP, through the plugin: `get_approved_spec`,
`next_task`, `get_acceptance_criteria`, `start_task`, `complete_task` and `release_task`.

Nothing on that surface can approve anything, which is asserted by a test that drives the
whole tool list through a real MCP client.

## Errors

Every failure returns the same shape, with a correlation id that also appears in the logs
and in `llm_calls`:

```json
{
  "error": {
    "code": "HASH_MISMATCH",
    "message": "the approved hash does not match the current artifact",
    "details": null,
    "correlation_id": "..."
  }
}
```

See [Error codes](/docs/errors) for the full list.
