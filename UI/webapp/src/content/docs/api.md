# API reference

Base URL is the host you are signed in to. All bodies are JSON.

## Authentication

Sessions use an HttpOnly cookie named `sid`, valid for 14 days. State-changing requests must send `Content-Type: application/json`. Browsers must call from the same origin. Scripts can use a cookie jar:

```bash
curl -c jar.txt -X POST https://YOUR_HOST/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@company.com","password":"your-password"}'
```

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | `name`, `email`, `password` (8+ chars) | Create an account and sign in |
| POST | `/api/auth/login` | `email`, `password` | Sign in |
| POST | `/api/auth/demo` | none | Create a demo workspace with a seeded spec |
| POST | `/api/auth/logout` | none | End the session |
| GET | `/api/me` | none | Current user, or 401 |

## Specs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/specs` | List your specs with status and cost |
| POST | `/api/specs` | Create a spec |
| GET | `/api/specs/:id` | Full detail: artifacts, approvals, audit, calls, tasks, cost |
| GET | `/api/specs/:id/artifact/:type/:version` | One artifact version, for diffs |
| POST | `/api/specs/:id/answers` | Answer clarifying questions |
| POST | `/api/specs/:id/decision` | Approve, reject or request changes |
| POST | `/api/specs/:id/cap` | Change the cost cap |

### Create a spec

```bash
curl -b jar.txt -X POST https://YOUR_HOST/api/specs \
  -H 'content-type: application/json' \
  -d '{
    "title": "Auto TDS on vendor payments",
    "description": "Deduct TDS on contractor payments and show it on each payment.",
    "mode": "brownfield",
    "profile": "dev",
    "cap_usd": 2
  }'
```

| Field | Type | Notes |
|---|---|---|
| `title` | string | 3 to 120 characters |
| `description` | string | 10 to 4000 characters |
| `mode` | `"greenfield"` or `"brownfield"` | Greenfield is a new project; brownfield scans an existing codebase. The earlier `case_type` (`"A"`/`"B"`) still works as an alias |
| `profile` | `"dev"` or `"demo"` | Model profile |
| `cap_usd` | number | 0.1 to 10, default 2 |

Returns `201` with `{ "id": "SPEC-XXXXXX" }`.

### Approve, reject or request changes

```bash
curl -b jar.txt -X POST https://YOUR_HOST/api/specs/SPEC-XXXXXX/decision \
  -H 'content-type: application/json' \
  -d '{"decision":"approve","expected_version":4,"content_hash":"<artifact hash>","comment":null}'
```

`expected_version` is the spec's current state version and `content_hash` is the artifact hash from `GET /api/specs/:id`. `decision` is `approve`, `reject` or `request_changes` (the contract's `APPROVAL_DECISIONS`); a comment is required for the last two. The earlier `version`, `hash` and `changes` names still work as aliases.

## Implementation hand-off

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/specs/:id/hook` | Body `{ "tool": "Edit" }`. Returns `allow` or `deny` with a reason |
| POST | `/api/specs/:id/tasks/:key/complete` | Body `{ "evidence": "..." }`. Allowed once the spec is ready to implement |

## Evidence tools

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/lab/repo` | Sample repo files and symbols |
| POST | `/api/lab/search` | Body `{ "q": "..." }`. Retrieval trace, candidate files and verified claims |
| POST | `/api/lab/verify` | Body `{ "claims": [{ "file", "line_start", "line_end", "symbol" }] }` |
| GET | `/api/compliance` | Rules and pack version |
| POST | `/api/compliance/lint` | Body `{ "text": "..." }`. Rejects legacy 194-series references |

## Errors

Errors return the contract envelope: `{ "error": { "code": "VERSION_CONFLICT", "message": "...", "details": null, "correlation_id": null } }`, plus a top-level `message` for convenience. See [Errors and troubleshooting](/docs/errors) for every code.
