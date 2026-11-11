# Core concepts

## The pipeline

Every spec moves through the same stages. Only the orchestrator can move it forward.

| Stage | Output | Gate |
|---|---|---|
| Context *(existing codebase only)* | Repo map and verified claims about your code | None |
| Requirements | `requirements.md` in EARS format | Clarifying questions, then your approval |
| Design | `design.md` with `file:line` evidence | Your approval |
| Tasks | Tasks linked to requirements and tests | None |
| Implementation | Tasks completed with evidence | Unlocked only after both approvals |

A spec can be sent back with **Request changes** or **Reject**; both return it straight to drafting. The agent drafts a new version and the old one stays in the version history, where you can compare any two versions.

## Governance rule

> Agents propose, the orchestrator transitions, humans approve.

- The orchestrator is the only writer of a spec's status.
- Every transition uses **optimistic locking**. A stale page cannot overwrite a newer state.
- Design drafting refuses to start unless the approved requirements hash matches the current requirements.

## Approvals

An approval records who decided, what they decided and the SHA-256 hash of the artifact. If the artifact changes before you submit, the API returns `HASH_MISMATCH` and nothing is recorded.

## Audit log

Each transition appends a row to the audit log. Database triggers reject updates and deletes, so history cannot be rewritten. The **Audit** tab shows the full trail for a spec.

## Edit hook

The hook answers one question for your coding agent: *may this tool run right now?* Read-only tools are always allowed. `Edit` and `Write` are allowed only when the spec is **Ready to implement** or **Implementing**. Call it with `POST /api/specs/:id/hook`.

## Spend cap

Model calls run on your own key (see [Bring your own key](/docs/byok)), so the cap protects your account. Each spec has a per-run cap (default $2, range $0.10 to $10). Before every model call the orchestrator checks the projected total and refuses with `BUDGET_EXCEEDED` (HTTP 402) if it would be exceeded. Raise the cap on the **Cost** tab to continue. The ledger lists tokens and cost for every call, including cache reads and writes.

| Profile | Models | Use for |
|---|---|---|
| Development | Haiku 5.5 for every stage | Cheapest, good for iteration |
| Demo | Sonnet 5.5 for requirements, design and tasks | Higher quality output |

## Hindi and Hinglish input

You can write a feature request in Hindi or Hinglish. The spec is always written in English, so only the input is multilingual. In this demo build the drafting is simulated: your text is carried into the requirements as written and the generated wording is English. Try the **Monthly ledger export (Hinglish)** example on the New spec page.
