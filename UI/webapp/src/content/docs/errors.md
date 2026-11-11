# Errors and troubleshooting

## Error codes

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | A field is missing or invalid | Read `message` and fix the input |
| `UNAUTHORIZED` | 401 | No valid session | Sign in again |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password | Check both and retry |
| `BUDGET_EXCEEDED` | 402 | The next model call would exceed the cost cap | Raise the cap on the Cost tab |
| `FORBIDDEN_ORIGIN` | 403 | A browser request came from another site | Call the API from the same origin |
| `NOT_FOUND` | 404 | The spec or artifact does not exist, or is not yours | Check the id |
| `EMAIL_TAKEN` | 409 | An account with this email exists | Sign in instead |
| `ILLEGAL_TRANSITION` | 409 | That move is not in the transition table, or the actor is not allowed to make it (agents can never approve) | Reload and check the allowed next steps |
| `VERSION_CONFLICT` | 409 | Someone else changed the spec first | Reload and retry |
| `HASH_MISMATCH` | 409 | The content hash you approved is not the current document | Reload, re-read, then decide again |
| `PRECONDITION_FAILED` | 409 | A gate precondition failed, for example nothing is awaiting approval | Check the spec status |
| `BAD_CONTENT_TYPE` | 415 | Missing `Content-Type: application/json` | Add the header |
| `INTERNAL` | 500 | Unexpected server error | Retry; report if it persists |

These codes are the `ERROR_CODES` taxonomy from the AgentForge contract package. Auth-only codes (`UNAUTHORIZED`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`) are specific to this hosted build.

## Troubleshooting

### I cannot sign in or sign up

- Use a password of at least 8 characters and a valid email address.
- Cookies must be enabled. The session cookie is `HttpOnly` and `SameSite=Lax`.
- If you are redirected back to the sign-in page, your session expired. Sign in again.
- Scripts must send `Content-Type: application/json`.

### A decision was refused with `HASH_MISMATCH`

Another draft was created while you were reviewing. Reload the spec, read the new version and approve again.

### The spec stopped with `BUDGET_EXCEEDED`

The run hit its dollar limit. Open the **Cost** tab, raise the cap and continue.

### Edit hook returns `deny`

Both approvals are required. Check the **Requirements** and **Design** gates.
